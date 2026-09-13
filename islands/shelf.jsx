/* shelf.jsx —— books 模块内嵌 3D 书架（按需加载本文件；容器每次出现都重新挂载） */
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { BookshelfScene } from "../../../灵感开发项目一/threeui/src/shaders/bookshelf/BookshelfScene";

function mount(host) {
  if (!host || host.__shelfMounted) return;
  host.__shelfMounted = true;
  host.dataset.state = "on";
  createRoot(host).render(h(BookshelfScene));
}

const existing = document.getElementById("books-shelf");
if (existing) mount(existing);

/* 用户可反复开关书架区块：监听新容器出现（旧容器随视图销毁） */
new MutationObserver(() => {
  const host = document.getElementById("books-shelf");
  if (host) mount(host);
}).observe(document.body, { childList: true, subtree: true });
