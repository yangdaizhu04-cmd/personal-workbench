/* 个人工作台桌面版（Tauri 2）

- 系统托盘常驻：左键显示/隐藏窗口；右键菜单「显示主窗口 / 切换开机自启 / 退出」
- **关闭窗口 = 收进托盘（不退出）**：退出了就没法在关窗状态发提醒，这是后台提醒的前提
- 全局快捷键 Ctrl+K：任意界面唤出命令面板
- 后台提醒：前端把算好的「提醒清单」（绝对时间戳）推过来，本进程每 20 秒扫一次；
  **窗口可见且未最小化时不发** —— 那时前端自己会发（main.js/checkReminders），
  否则同一条提醒会前后端各响一次。窗口隐藏/最小化/已关窗时由这里发系统通知。
- 数据只在 WebView 的 localStorage 里，Rust 读不到，所以清单必须由前端推；
  清单在数据变化时防抖重推，另每 30 分钟兜底重推一次。
- 开机自启：tauri-plugin-autostart（设置页与托盘菜单都能开） */
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashSet;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::ShortcutState;
use tauri_plugin_notification::NotificationExt;

/// 一条提醒。`at` 与 `until` 都是**前端按本地时区算好的 unix 毫秒**：
/// `at` 到点提醒，`until` 是有效期（过了就作废，不再补发）。
/// Rust 侧不做任何日期推算 —— 时区、农历、业务日边界全在前端，只有一份口径；
/// 有效期也由前端给，因为"这个提醒什么时候算过期"是业务判断，不是定时器的事
#[derive(Clone, serde::Deserialize, serde::Serialize)]
struct Reminder {
    id: String,
    at: i64,
    /// `#[serde(default)]` 是必须的：前后端版本一旦错开（改了前端忘了重建 desktop/dist），
    /// 严格结构体会让**整批**推送反序列化失败 → 后台提醒整体静默，且打包后看不到任何报错
    #[serde(default)]
    until: i64,
    title: String,
    body: String,
}

impl Reminder {
    /// 有效期缺失或算错时退回到"到点后 30 分钟"，与网页版待办提醒的窗口一致。
    /// 宁可少发，也不能因为一个字段缺失把整批提醒都丢掉
    fn effective_until(&self) -> i64 {
        if self.until > self.at {
            self.until
        } else {
            self.at + 30 * 60 * 1000
        }
    }
}

#[derive(Default)]
struct ReminderState {
    list: Mutex<Vec<Reminder>>,
    /// 已发过的 id（免得 20 秒一轮里同一条反复弹）
    fired: Mutex<HashSet<String>>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 收到清单时顺手在应用数据目录写一份 `reminders.json`。
/// 它不参与提醒逻辑（清单靠前端每 30 分钟重推），只是排障用的"最后收到的那份"——
/// 排查"关窗后到底有没有提醒"时有这一个文件就能分清是前端没推还是没发出去
fn write_diag(app: &AppHandle, list: &[Reminder]) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(json) = serde_json::to_string_pretty(list) {
            let _ = std::fs::write(dir.join("reminders.json"), json);
        }
    }
}

/// 前端推清单（数据变化时防抖推一次；后台提醒开关关掉时推空数组）
#[tauri::command]
fn set_reminders(
    app: AppHandle,
    state: tauri::State<'_, ReminderState>,
    list: Vec<Reminder>,
) -> usize {
    let n = list.len();
    if let Ok(mut guard) = state.list.lock() {
        *guard = list.clone();
    }
    write_diag(&app, &list);
    n
}

/// 自检：立刻发一条，并**说清用的是哪条通道** ——
/// "没看到通知"这个反馈里最难查的就是"到底发出去没有、走的哪条路"
#[tauri::command]
async fn test_notify(app: AppHandle) -> Result<String, String> {
    let (ch, rx) = notify(
        &app,
        "个人工作台 · 通知自检",
        "关掉窗口也能收到提醒 ✓（这条是自检）",
        None,
    )?;
    if ch == "system" {
        return Ok("已通过系统通知发出（会进通知中心）".to_string());
    }
    /* 提醒卡是异步建的：这里等它的**真实**结果再回话（最多 5 秒）。
       本命令是 async 命令 → 跑在异步线程池上，等待不会自锁（踩坑 #081 炸的是同步命令）。
       不等的话，窗口没建出来也会照答"已弹出提醒卡"，那是给排障挖坑 */
    let waited: Option<Result<String, String>> =
        rx.and_then(|r| r.recv_timeout(Duration::from_secs(5)).ok());
    match waited {
        Some(Ok(_)) => Ok(if installed() {
            "系统通知没发出去，已改弹提醒卡（右下角，9 秒后自动收起）".to_string()
        } else {
            "已弹出工作台自己的提醒卡：右下角，9 秒后自动收起".to_string()
        }),
        Some(Err(e)) => Err(format!("提醒卡没弹出来：{e}（详见 toast.log）")),
        None => Err(
            "提醒卡已派发，但 5 秒内没等到窗口建好 —— 主线程可能被卡住，详见 toast.log"
                .to_string(),
        ),
    }
}

/// 前端是否在"看得见"的状态：可见且未最小化才算看得见。
/// 最小化时 Windows 的 is_visible 仍是 true，但用户其实看不到通知该由后台补。
fn front_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .unwrap_or(false)
}

/* ---------- 提醒通道 ----------
   一个反直觉的事实：**"能发通知"和"能看见通知"是两件事**。
   Windows 的系统通知（toast）要求程序有一个带 AUMID 的身份：装过的应用由安装包建快捷方式，
   所以能弹；而直接跑 target\release 里的 exe（便携版）没有这层身份 ——
   tauri-plugin-notification 也认得这点，它在便携模式下**故意不设置 app_id**，
   于是 notify-rust 退回用 `Toast::POWERSHELL_APP_ID` 发，而新版 Windows 已经没有
   「Windows PowerShell」快捷方式了，通知就被系统静默丢掉（`show()` 仍返回 Ok）。
   结论：便携模式不赌系统通知，改弹工作台自己的提醒卡 —— 一定能看见，且是自家的样子。 */

/// 是否在跑编译产物（便携模式）：装了之后 exe 在 %LOCALAPPDATA%\... 下，不再是 target\release
fn portable() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_string_lossy().replace('/', "\\").to_lowercase()))
        .map(|d| d.ends_with("\\target\\release") || d.ends_with("\\target\\debug"))
        .unwrap_or(false)
}

/// 是否**真的装过**（决定能不能用系统通知）。
/// 光看"不在 target\release"不够：把 exe 拷到 D:\tools\ 也不是便携、更没装过，
/// 那种情况下系统通知照样被静默丢掉。装过就会在开始菜单留一个快捷方式，以它为准
fn installed() -> bool {
    if portable() {
        return false;
    }
    std::env::var("APPDATA")
        .ok()
        .map(|d| {
            std::path::Path::new(&d)
                .join("Microsoft\\Windows\\Start Menu\\Programs\\个人工作台.lnk")
                .exists()
        })
        .unwrap_or(false)
}

/// 提醒卡的内容 + **代次**：窗口是复用的，新窗口开出来后靠 `toast_payload` 取当前该显示什么。
///
/// **代次和内容必须放在同一把锁里一起写、一起读**（踩坑 #082）：分成两个变量存，就会出现
/// "新内容配旧代次"的组合，前端按代次一比会把新内容当成旧的丢掉 —— 表现正是
/// "同一轮里第 2 条及以后的提醒，内容永远显示不出来"。
/// 代次还兼着自动收起的判断：9 秒内又来了新的（代次变了），旧的那条就不关窗，接着显示新的
#[derive(Default)]
struct ToastState {
    /// (代次, 标题, 正文)
    last: Mutex<(u64, String, String)>,
}

#[tauri::command]
fn toast_payload(state: tauri::State<'_, ToastState>) -> serde_json::Value {
    let g = state.last.lock().map(|v| v.clone()).unwrap_or_default();
    serde_json::json!({"gen": g.0, "title": g.1, "body": g.2})
}

/// 前端在窗口**可见**时把提醒交给这里，走同一条通道。
/// 为什么不能让前端直接用浏览器的 Notification API：Tauri 用的是 WebView2，
/// 而 WebView2 的 Notification 需要宿主实现回调才会显示 —— Tauri 没实现，
/// 于是 `new Notification()` 会被**静默丢弃**：应用开着的时候什么也看不到，
/// 关掉窗口反倒能收到卡片，同一件事两条路两种结果（踩坑 #079）
#[tauri::command]
async fn notify_now(app: AppHandle, title: String, body: String) -> Result<String, String> {
    /* async：命令跑在异步线程池上而不是主线程。**这条很关键** ——
       同步命令是在主线程上执行的，而 notify_card 内部要把建窗动作派发回主线程；
       同步命令 + 派发就变成"主线程等自己"（踩坑 #081）。
       这里不等提醒卡的结果（前端只关心"发成功了没"，卡片成不成它自己能看见） */
    notify(&app, &title, &body, None).map(|(ch, _)| ch)
}

/// 点提醒卡 = 唤出主窗口
#[tauri::command]
fn toast_click(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    if let Some(t) = app.get_webview_window("toast") {
        let _ = t.close();
    }
}

/// 算出卡片该去的位置（逻辑坐标，主屏右下角、让开任务栏）以及那块屏的缩放：
/// 调用方拿它先摆一次，显示后再核对一次。换分辨率/多屏时每次弹都重新算，不记旧坐标。
/// 返回 `None` = 一块监视器都问不出来（窗口会停在系统层叠位，就是"白框不在右下角"的样子）
fn bottom_right_pos(
    app: &AppHandle,
    w: &tauri::WebviewWindow,
) -> Option<(tauri::LogicalPosition<f64>, f64)> {
    /* 主屏 → 主窗口所在的那块屏 → 任意一块能问到的屏。
       最后这层是有用的：提醒的触发前提就是主窗口已隐藏（见 spawn_reminder_loop），
       而隐藏的窗口还能不能报出自己所在的监视器，要看平台实现 —— 不能只有它这一条退路 */
    let mon = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| {
            app.get_webview_window("main")
                .and_then(|m| m.current_monitor().ok().flatten())
        })
        .or_else(|| app.available_monitors().ok().and_then(|ms| ms.into_iter().next()))?;
    let scale = mon.scale_factor();
    let ms = mon.size().to_logical::<f64>(scale);
    let ws = w
        .outer_size()
        .map(|s| s.to_logical::<f64>(scale))
        .unwrap_or_else(|_| tauri::LogicalSize::new(360.0_f64, 138.0_f64));
    Some((
        tauri::LogicalPosition::new(
            (ms.width - ws.width - 18.0).max(0.0),
            (ms.height - ws.height - 58.0).max(0.0),
        ),
        scale,
    ))
}

/// 极简百分号编码：内容要放进 URL 片段，这样**页面首帧就能画出内容**，
/// 不必等 IPC（IPC 一旦被权限/版本问题挡住，窗口会是一片空白 —— 那种失败最难查）
fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// 派发一条提醒卡（自绘窗口，便携模式下代替系统通知）。
///
/// **这里是派发即返回**：建窗、显示都在主线程上做，返回时窗口还没出来。
/// 真实结果（成功描述 / 失败原因）从返回的 receiver 里送出 —— `fired_id` 给定时，
/// 也由那个闭包顺手把结果写进 `fired.log`：只有闭包自己知道窗口到底建出来没有，
/// 在外层写只能写"已派发"，那是把失败也记成 ok（踩坑 #082）。
fn notify_card(
    app: &AppHandle,
    title: &str,
    body: &str,
    fired_id: Option<String>,
) -> Result<mpsc::Receiver<Result<String, String>>, String> {
    let (tx, rx) = mpsc::channel::<Result<String, String>>();

    /* 代次与内容一起写进 ToastState（同一把锁）：内容是"当前该显示什么"，
       代次是"这是第几条" —— 前端两样都要，用来判断自己手上的是不是旧的。
       写不进状态就直接失败：那种情况下卡片会显示上一条的内容，
       与其发一条错的，不如让 fired.log 记下 err */
    let gen = {
        let state = app.state::<ToastState>();
        let mut g = state
            .last
            .lock()
            .map_err(|_| "提醒卡状态锁坏了".to_string())?;
        g.0 += 1;
        g.1 = title.to_string();
        g.2 = body.to_string();
        g.0
    };

    /* **建窗/摆放/显示必须整段在主线程上做**：Windows 的窗口与消息循环属于创建它的线程，
       从别的线程建出来的窗口不会渲染、点不动，标题栏上写着「(未响应)」，内容一片白。

       但**绝不能在这里阻塞等结果**（第一版就是这么写的，踩坑 #081）：
       `test_notify` 是同步命令、本身就跑在主线程上，它一调 run_on_main_thread 再等，
       主线程就被自己锁住 → 6 秒超时返回错误 → 那个排队的闭包稍后照样执行（窗口建出来了、
       位置还没摆对），而"9 秒后自动收起"那段在超时后就没机会执行 →
       **屏幕上留下一个永远不消失的窗口**，日志里一个字都没有。
       所以：整段（含写日志）都放进闭包里，调用方立刻返回，谁调都不会自锁；
       想知道结果就收那条 receiver（自检收，提醒循环不收）。

       日志要写在这里而不是外面：只有这个闭包真的跑了，才能说清窗口到底建成什么样 */
    let app2 = app.clone();
    let (t, b) = (title.to_string(), body.to_string());
    app.run_on_main_thread(move || {
        let res = (|| -> Result<String, String> {
            let win = match app2.get_webview_window("toast") {
                Some(w) => w,
                None => WebviewWindowBuilder::new(
                    &app2,
                    "toast",
                    /* 内容（连代次）放进 URL 片段：页面**第一帧**就能画出来，不依赖 IPC */
                    WebviewUrl::App(format!("toast.html#{gen}|{}|{}", enc(&t), enc(&b)).into()),
                )
                .title("个人工作台 · 提醒")
                .inner_size(360.0, 138.0)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .focused(false)
                .build()
                .map_err(|e| format!("建窗失败：{e}"))?,
            };
            let want = bottom_right_pos(&app2, &win);
            if let Some((p, _)) = want {
                let _ = win.set_position(p);
            }
            /* 内容分两条路推给页面，因为**每条路都会在特定时序下失效**：
               - `emit`：正规事件通道。但页面的 listen 是异步注册的，
                 窗口刚建出来、页面还没跑起来时发的事件会被直接丢掉
               - `eval`：Rust 直接往 WebView 注入脚本，不经过 IPC。
                 页面脚本还没跑起来时是空操作（`window.__toastPaint` 还不存在）
               两条都走一遍。真正兜底的是页面自己：它加载完会无条件拉一次 `toast_payload`
               并按代次覆盖 —— 所以"同一轮里第 2 条内容永远不显示"那个漏洞不会再出现 */
            let payload = serde_json::json!({"gen": gen, "title": t.as_str(), "body": b.as_str()});
            let _ = win.emit("toast:show", payload.clone());
            if let Ok(js) = serde_json::to_string(&payload) {
                let _ = win.eval(format!("window.__toastPaint && window.__toastPaint({js})"));
            }
            let _ = win.show();
            /* 显示前设的坐标有时会被系统忽略（踩坑 #081 那次窗口就停在 156,156），
               所以显示后核对一次 —— **只在真的偏了才纠偏**：每次都重设会让卡片先在
               别处出现、再跳到右下角，那一跳比稍微歪一点更显眼 */
            if let Some((p, scale)) = want {
                if let Ok(cur) = win.outer_position() {
                    let cur = cur.to_logical::<f64>(scale);
                    if (cur.x - p.x).abs() > 2.0 || (cur.y - p.y).abs() > 2.0 {
                        let _ = win.set_position(p);
                    }
                }
            }
            /* 记下窗口的真实状态：有没有标题栏 / 多大 / 在哪 —— 出问题时这一行就是证据 */
            let sz = win
                .outer_size()
                .map(|s| format!("{}x{}", s.width, s.height))
                .unwrap_or_else(|_| "?".into());
            let pos = win
                .outer_position()
                .map(|p| format!("{},{}", p.x, p.y))
                .unwrap_or_else(|_| "?".into());
            Ok(format!(
                "装饰={} {} @ {}",
                win.is_decorated().unwrap_or(true),
                sz,
                pos
            ))
        })();
        match res {
            Ok(desc) => {
                append_log(&app2, "toast.log", &format!("ok | {t} | {desc}"));
                /* fired.log 写在这层，因为**这里才知道真实结果**（外层在派发时就返回了）。
                   末列写通道名，与 system 那条保持一致 */
                if let Some(id) = &fired_id {
                    append_log(&app2, "fired.log", &format!("{id} | ok | card | {desc}"));
                }
                let _ = tx.send(Ok(desc));
            }
            Err(e) => {
                append_log(&app2, "toast.log", &format!("err | {t} | {e}"));
                if let Some(id) = &fired_id {
                    append_log(&app2, "fired.log", &format!("{id} | err | card: {e}"));
                }
                let _ = tx.send(Err(e));
            }
        }
    })
    .map_err(|e| format!("回不到主线程：{e}"))?;

    /* 自动收起**在建窗请求发出后立刻安排**（注意上面那句 `?`：连派发都没成功时这里已经返回了，
       那种情况没建出窗口，自然也无需收起）。安排它不依赖建窗成功与否 ——
       否则一旦前一步出了岔子，屏幕上就会留一个永不消失的窗口。
       9 秒后关窗（同样回主线程）；期间又来了一条（代次变了）就不关，接着显示新的 */
    let app3 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(9));
        let cur = {
            let state = app3.state::<ToastState>();
            state.last.lock().map(|g| g.0).unwrap_or(gen) // 锁坏了就当自己是最新的，照常收起
        };
        if cur == gen {
            let app4 = app3.clone();
            let _ = app3.run_on_main_thread(move || {
                if let Some(w) = app4.get_webview_window("toast") {
                    let _ = w.close();
                }
            });
        }
    });
    Ok(rx)
}

/// 往应用数据目录里的某个日志追加一行（fired.log / toast.log 共用）
fn append_log(app: &AppHandle, file: &str, text: &str) {
    use std::io::Write;
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(file))
        {
            let _ = f.write_all(format!("{} | {}\n", now_ms(), text).as_bytes());
        }
    }
}

/// 发一条提醒。返回用掉的通道（system / card），card 那条另带回结果通道。
///
/// `fired_id` 给定时把结果写进 `fired.log`（应用数据目录）。排障时这一个文件就能分开
/// 三种情况：没触发（没有行）/ 系统拒了（err）/ 系统收下了（ok）—— 关窗之后没有任何界面
/// 可以看，没有这个日志就只剩猜。
/// **写在哪儿取决于哪条通道**：system 是同步结果，这里直接写；card 要等主线程把窗建出来
/// 才知道成败，所以由建窗闭包写、自检命令收那条 receiver 说真话
fn notify(
    app: &AppHandle,
    title: &str,
    body: &str,
    fired_id: Option<String>,
) -> Result<(String, Option<mpsc::Receiver<Result<String, String>>>), String> {
    if installed() {
        // 装过的应用有正经身份：系统通知能进通知中心、也尊重「专注助手」
        if app.notification().builder().title(title).body(body).show().is_ok() {
            if let Some(id) = &fired_id {
                append_log(app, "fired.log", &format!("{id} | ok | system"));
            }
            return Ok(("system".to_string(), None));
        }
    }
    match notify_card(app, title, body, fired_id.clone()) {
        Ok(rx) => Ok(("card".to_string(), Some(rx))),
        Err(e) => {
            /* 连派发回主线程都没成功：这一条也要留痕，否则 fired.log 里一片空白，
               会被读成"提醒根本没到点"（那是另一种问题，查法完全不同） */
            if let Some(id) = &fired_id {
                append_log(app, "fired.log", &format!("{id} | err | card: {e}"));
            }
            Err(format!("card: {e}"))
        }
    }
}

fn spawn_reminder_loop(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(20));
        if front_visible(&app) {
            continue;
        }
        let state = app.state::<ReminderState>();
        let now = now_ms();
        let due: Vec<Reminder> = match state.list.lock() {
            Ok(list) => list
                .iter()
                // 到点且还在有效期内才发：过了有效期就不再补发（重开工作台时
                // 不会把几天前的陈提醒一股脑弹出来），有效期由前端按类型给
                .filter(|r| r.at <= now && now <= r.effective_until())
                .cloned()
                .collect(),
            Err(_) => continue,
        };
        /* 去重表要清理，但**不能清空**：清空会把"仍在有效期内"（晨间 4h、收工 5h）的 id
           一起丢掉，下一轮扫描就会把今天已经响过的提醒再弹一遍。只保留"清单里还在的" id ——
           已经从清单里消失的，说明那条提醒不会再触发，这才是可以安全丢的 */
        let live: HashSet<String> = match state.list.lock() {
            Ok(l) => l.iter().map(|r| r.id.clone()).collect(),
            Err(_) => continue,
        };
        for r in due {
            {
                let mut fired = match state.fired.lock() {
                    Ok(f) => f,
                    Err(_) => continue,
                };
                if fired.contains(&r.id) {
                    continue;
                }
                fired.insert(r.id.clone());
                if fired.len() > 400 {
                    fired.retain(|id| live.contains(id));
                }
            }
            /* 结果不在这里看：system 那条在 notify 内部就写了日志，
               card 那条由建窗闭包写（这里是派发即返回，拿不到真实结果）。 */
            let _ = notify(&app, &r.title, &r.body, Some(r.id.clone()));
        }
    });
}

fn toggle_autostart(app: &AppHandle) {
    use tauri_plugin_autostart::ManagerExt;
    let m = app.autolaunch();
    match m.is_enabled() {
        Ok(true) => {
            let _ = m.disable();
        }
        _ => {
            let _ = m.enable();
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(ReminderState::default())
        .manage(ToastState::default())
        /* 单实例必须第一个注册：再开一个的时候把已有窗口叫到前面，
           而不是多出一个托盘图标、多起一条提醒线程（那会让同一条提醒弹两次）。
           开机自启 + 手动双击同时发生是很常见的场景 */
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["ctrl+k"])
                .unwrap()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                            // 通知前端打开命令面板
                            let _ = win.eval(
                                "if(window.WB&&WB.commands&&WB.commands.open){WB.commands.open();}",
                            );
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_reminders,
            test_notify,
            notify_now,
            toast_payload,
            toast_click
        ])
        .setup(|app| {
            // 托盘右键菜单。左键仍然是"显示/隐藏"（见下面 on_tray_icon_event）
            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let auto_item = MenuItem::with_id(app, "autostart", "切换开机自启", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出（不再提醒）", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &show_item,
                    &PredefinedMenuItem::separator(app)?,
                    &auto_item,
                    &quit_item,
                ],
            )?;

            let tray = TrayIconBuilder::with_id("wb-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("个人工作台 · 晨雾奶油")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "autostart" => toggle_autostart(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            let _ = tray;

            /* 关窗 = 收进托盘。**不这么做后台提醒就不成立**：
               窗口一销毁，WebView 里的 JS 全停，托盘也再无入口可以唤回窗口 */
            if let Some(win) = app.get_webview_window("main") {
                let w = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            spawn_reminder_loop(app.handle().clone());

            /* 调试钩子：`WB_SELFTEST_NOTIFY=1` 启动，8 秒后自动发一条提醒。
               用途是不用手点设置页的「通知自检」就能验证通道（尤其给自动化用）。
               平时不设这个环境变量，这里完全不执行 */
            if std::env::var("WB_SELFTEST_NOTIFY").is_ok() {
                let h = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(8));
                    let r = notify(&h, "个人工作台 · 自检", "后台线程路径（定时提醒走这条）", None);
                    eprintln!("[selftest] 后台线程 notify -> {r:?}");
                    std::thread::sleep(Duration::from_secs(10));
                    /* 再模拟一次前端那个命令：**在主线程上**调 notify ——
                       这正是当初会自锁、把窗口永远留在屏幕上的那条路（踩坑 #081）。
                       失败要留证据，别用 `let _ =` 吞掉 */
                    if let Err(e) = h.clone().run_on_main_thread({
                        let h = h.clone();
                        move || {
                            let r = notify(
                                &h,
                                "个人工作台 · 自检",
                                "主线程路径（自检按钮走这条）",
                                None,
                            );
                            eprintln!("[selftest] 主线程 notify -> {r:?}");
                        }
                    }) {
                        eprintln!("[selftest] 回不到主线程：{e}");
                    }
                    std::thread::sleep(Duration::from_secs(10));
                    /* 背靠背两条 = 同一个 20 秒 tick 里有两条到点，正是"第 2 条内容永不显示"
                       那个 bug 的现场（踩坑 #082）：卡上应当出现**第 2 条**的内容
                       （同一张卡显示最新一条，9 秒后自动收起），fired.log 里两行都该是 ok */
                    let r1 = notify(
                        &h,
                        "个人工作台 · 自检 1/2",
                        "背靠背第 1 条（这条不该停在卡上）",
                        Some("selftest-1".to_string()),
                    );
                    let r2 = notify(
                        &h,
                        "个人工作台 · 自检 2/2",
                        "背靠背第 2 条（卡片上应该是这条）",
                        Some("selftest-2".to_string()),
                    );
                    eprintln!("[selftest] 背靠背两条 -> {r1:?} / {r2:?}");
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
