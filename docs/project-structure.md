# Co-Desk 项目框架说明

## 项目定位

Co-Desk 是一个面向人机交互课程项目的桌面端联机自习软件。它不是网页展示页，而是一个 Electron 桌面客户端，连接 FastAPI 云端后端，并使用 SQLite 保存用户、任务、房间、专注记录和排行榜数据。

## 技术架构

```text
Co-Desk 桌面客户端
  Electron
  React + TypeScript
  Vite
  Web Audio API
        |
        | REST API / WebSocket
        v
Co-Desk 后端服务
  FastAPI
  WebSocket
  SQLite
        |
        v
Render 云端部署
```

## 核心功能

- 账号注册与登录
- 自习房间创建与加入
- WebSocket 实时在线状态
- 同伴座位与专注状态显示
- 番茄钟专注计时
- 待办便利贴
- 环境音模拟
- 鼓励卡轻互动
- 专注时间统计
- 自习时间排行榜

## 目录说明

```text
.
├─ electron/
│  └─ main.cjs                 Electron 主进程，负责打开桌面窗口
├─ server/
│  ├─ main.py                  FastAPI 后端、SQLite 建表、REST API、WebSocket
│  ├─ requirements.txt         Python 后端依赖
│  ├─ Dockerfile               Render/Docker 部署配置
│  └─ Procfile                 备用部署入口
├─ src/
│  ├─ App.tsx                  React 主界面与核心交互逻辑
│  ├─ api.ts                   前端 API 请求封装
│  ├─ types.ts                 TypeScript 数据类型
│  ├─ main.tsx                 React 启动入口
│  ├─ styles.css               全局界面样式
│  └─ vite-env.d.ts            Vite 类型声明
├─ docs/
│  ├─ deploy-render.md         Render 公网部署说明
│  └─ project-structure.md     当前项目框架说明
├─ package.json                前端/Electron 依赖与脚本
├─ vite.config.ts              Vite 构建配置
├─ render.yaml                 Render Blueprint 配置
├─ start-codesk.cmd            本地开发版一键启动入口
└─ README.md                   项目说明与启动方式
```

## 本地运行

第一次运行：

```bash
npm install
python -m pip install -r server/requirements.txt
```

启动开发版：

```bash
npm run dev
```

或直接双击：

```text
start-codesk.cmd
```

## 打包 Windows 客户端

生产构建默认连接云端后端：

```text
https://co-desk-api.onrender.com
```

打包命令：

```bash
npm run build
npx electron-builder --win dir --x64
```

生成目录：

```text
release/win-unpacked/
```

分发时需要把整个 `win-unpacked` 文件夹压缩发送，不能只发送 `Co-Desk.exe`。

## 云端部署

后端部署在 Render，配置文件为：

```text
render.yaml
server/Dockerfile
```

Render 部署完成后，客户端填写云端服务地址即可联机：

```text
https://co-desk-api.onrender.com
```
