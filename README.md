# Co-Desk 桌面端 MVP

这是人机交互课程项目的可运行版本：一个 Electron 桌面客户端，连接 FastAPI 后端，并用 SQLite 保存任务、房间和专注记录。

## 已完成

- Electron + React 桌面客户端
- FastAPI 后端服务
- SQLite 数据库自动建表
- 自习房间列表与自定义房间
- WebSocket 实时同步在线同伴、座位和专注状态
- 番茄钟、任务便利贴、任务拆解
- 环境音模拟与座位方向试听
- 鼓励卡轻互动
- 专注记录统计

## 启动

第一次运行：

```bash
npm install
python -m pip install -r server/requirements.txt
```

开发运行：

```bash
npm run dev
```

运行后会同时启动：

- 后端 API: `http://127.0.0.1:8124`
- 前端 Vite: `http://127.0.0.1:5173`
- Electron 桌面窗口

如果要真正互联网联机，把后端部署到云端，然后在客户端左侧“后端服务器”里填入云端地址。部署步骤见：

- [docs/deploy-render.md](docs/deploy-render.md)

## 项目结构

```text
.
├─ electron/        Electron 主进程
├─ docs/            部署与项目说明
├─ server/          FastAPI + SQLite 后端
├─ src/             React 桌面端界面
├─ data/            SQLite 数据库运行时目录
└─ dist/            前端构建产物
```
