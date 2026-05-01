# Co-Desk 公网联机部署说明

这个版本的 Co-Desk 已经支持真正互联网联机。做法是把 `server/` 后端部署到云端，然后所有桌面客户端都连接同一个云端 API。

## 推荐架构

```text
Electron 桌面客户端
  -> HTTPS REST API
  -> WSS WebSocket
云端 FastAPI 服务
  -> SQLite 数据库
```

课程展示阶段可以继续使用 SQLite。免费云平台的文件系统可能会重置，所以正式产品再换 PostgreSQL。

## Render 部署

1. 把整个项目推到 GitHub。

2. 打开 Render，创建 `New Web Service`。

3. 选择这个仓库。

4. 选择 Docker 部署，Render 会读取根目录的 `render.yaml`。

5. 确认环境变量：

```text
HOST=0.0.0.0
CODESK_DATA_DIR=/app/data
CODESK_CORS_REGEX=.*
```

`render.yaml` 已经指定：

```yaml
dockerfilePath: ./server/Dockerfile
dockerContext: ./server
```

这表示 Render 会在 `server/` 目录内构建后端镜像。

6. 部署成功后，Render 会给一个地址，例如：

```text
https://co-desk-api.onrender.com
```

7. 打开 Co-Desk 桌面客户端，在左侧“后端服务器”里填入这个地址，点击连接按钮。

8. 让其他同学也填同一个地址。大家进入同一个房间后，就能看到在线人数、座位状态、专注状态和鼓励卡实时同步。

## 本地测试云端模式

如果后端仍在本机运行，可以填：

```text
http://127.0.0.1:8124
```

如果后端部署到了云端，应填：

```text
https://你的云端服务地址
```

客户端会自动把 WebSocket 地址换成：

```text
wss://你的云端服务地址
```

## 当前已经支持的联机内容

- 多人进入同一个自习房间
- 房间在线人数
- 同伴座位
- 同伴当前状态：准备中 / 专注中
- 当前任务名称
- 番茄钟剩余时间
- 环境音类型
- 鼓励卡实时广播

## 后续如果要做真实麦克风环境音

真实环境音需要 WebRTC：

```text
FastAPI WebSocket: 只做信令交换
WebRTC: 传输麦克风音频
STUN/TURN: 处理不同网络下的连接
Web Audio API: 做空间音频渲染
```

建议答辩时把真实麦克风音频作为未来版本，因为它涉及隐私提示、麦克风权限、降噪、回声消除和 TURN 服务成本。
