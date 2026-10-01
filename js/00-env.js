/* 00-env.js —— 云端环境配置（部署脚本会自动改写 cloudBaseUrl；本地双击版留空即可） */
window.WB_ENV = {
  /* 云函数 HTTP 访问根地址，形如：
     https://<envId>.service.tcloudbase.com
     三个云函数路径分别为 /gate /sync /proxy（在云控制台开启"HTTP 访问服务"后生效） */
  cloudBaseUrl: "",
};

/* ---- 全局错误兜底（最早执行，保证先于一切模块挂载） ----
   单模块抛错不该拖垮整个工作台：记录并继续，才轮得到界面把问题丢给用户。
   自身不抛错（addEventListener 本身失败不可能；handler 内也是 try 包着做最保守的记录）。 */
(function(){
  try{
    /* console.error 原样保留（test-smoke 等仍按 console/page error 断言），同时额外记一行
       带「模块名」的定位线索 —— 全站脚本都是 IIFE 平铺加载，栈顶就是出错文件，比裸 Error 好查 */
    addEventListener("error", e => {
      try{
        console.error("[wb] 未捕获异常:", e.message, "@", (e.filename || "").split(/[\\/]/).pop() + ":" + e.lineno);
      }catch(_){}
    });
    addEventListener("unhandledrejection", e => {
      try{
        console.error("[wb] 未处理的 Promise rejection:", (e.reason && e.reason.message) || e.reason);
      }catch(_){}
    });
  }catch(_){}
})();
