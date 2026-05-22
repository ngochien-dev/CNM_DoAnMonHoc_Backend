# 🚀 OTT Project — Backend Architecture & API Documentation

**Version**: 7.0 | **Last Updated**: 2026-05-22 | **Status**: Production-Ready

Tài liệu này cung cấp cái nhìn toàn diện về kiến trúc hệ thống, chức năng của từng thư mục, tệp tin và hướng dẫn triển khai phía Backend của nền tảng nhắn tin/gọi điện OTT (One-to-One Messaging & Video Call Platform).

---

## 🎯 Overview

**OTT Backend** là một **REST API + WebSocket server** được xây dựng trên Express.js, cung cấp:
- ✅ **Real-time Messaging** (1-1, Group chat với Socket.IO)
- ✅ **Video/Audio Calls** (WebRTC P2P signaling)
- ✅ **User Management** (JWT Auth, Profile, Friends, Block)
- ✅ **Group Management** (Create, Members, Admin roles)
- ✅ **Admin Dashboard** (Statistics, User Management)
- ✅ **File Storage** (AWS S3 Integration)
- ✅ **Cloud Notifications** (Firebase Cloud Messaging)
- ✅ **AI Chatbot** (Google Gemini Integration)
- ✅ **Stories** (24h expiry)
- ✅ **Posts** (với comments & reactions)
- ✅ **Search** (Users, Groups, Messages)

**Tech Stack**: Node.js + Express.js + Socket.IO + AWS DynamoDB + S3

---

## 📂 Cấu trúc thư mục (Directory Structure)

```
backend/
├── controllers/          # 13 request handlers
│   ├── authController.js
│   ├── userController.js
│   ├── messageController.js
│   ├── groupController.js
│   ├── friendController.js
│   ├── callController.js
│   ├── adminController.js
│   ├── chatbotController.js
│   ├── notificationController.js
│   ├── storyController.js
│   ├── postController.js
│   ├── searchController.js
│   └── utilsController.js
├── middlewares/          # Auth & validation
│   ├── authMiddleware.js (JWT validation)
│   ├── sanitize.js (XSS protection)
│   └── socketAuth.js
├── models/               # Database layer
│   ├── userModel.js
│   ├── callModel.js
│   └── awsConfig.js
├── routes/               # 13 API endpoint files
├── services/             # Business logic
│   ├── s3Service.js
│   ├── messageService.js
│   ├── callService.js
│   └── fcmService.js
├── socket/               # Real-time events
│   ├── index.js (Socket.IO setup)
│   ├── chatSocket.js (messaging events)
│   └── callSocket.js (WebRTC signals)
├── store/                # In-memory state
│   ├── presenceStore.js (online/offline)
│   └── activeCalls.js (call tracking)
├── utils/
│   └── webrtcConfig.js
├── server.js             # Express app entry
├── awsConfig.js
├── package.json
└── .env
```

Dưới đây là chi tiết vai trò của từng thư mục và tệp tin mã nguồn trong hệ thống Backend:

### `controllers/`
Chứa toàn bộ logic xử lý các yêu cầu HTTP từ Client, giao tiếp với các Model/Service và trả về phản hồi (Response) dạng JSON.

| Controller | Chức năng chính |
|-----------|----------------|
| **`authController.js`** | Đăng ký, đăng nhập, OTP verify, quên mật khẩu, đổi mật khẩu, auto logout on password change |
| **`userController.js`** | Tìm kiếm user, view/edit profile, avatar upload, status updates |
| **`messageController.js`** | CRUD tin nhắn, file attachment (S3), message recall/delete, pinning, polls/voting |
| **`groupController.js`** | Tạo/quản lý nhóm, thêm/xóa thành viên, admin roles |
| **`friendController.js`** | Friend request, accept/reject, remove friend, block list |
| **`callController.js`** | WebRTC signaling, ICE candidates, call history |
| **`chatbotController.js`** | Google Gemini integration, auto-reply |
| **`adminController.js`** | User statistics, message analytics, user ban/unban, password reset |
| **`notificationController.js`** | FCM push notifications, notification history |
| **`storyController.js`** | Story create/view, 24h expiry, reactions |
| **`postController.js`** | Post CRUD, comments, likes/reactions |
| **`searchController.js`** | Global search (users, groups, messages) |
| **`utilsController.js`** | File upload helpers, data processing |

### `middlewares/`
Các hàm trung gian kiểm tra và xác thực yêu cầu trước khi chuyển tiếp đến Controller chính.

| Middleware | Mục đích |
|-----------|---------|
| **`authMiddleware.js`** | JWT token validation, Bearer token extraction, isVerified check, isBanned check |
| **`socketAuth.js`** | Socket.IO authentication & token validation |
| **`sanitize.js`** | XSS protection, HTML sanitization, script injection blocking |

### `models/`
Định nghĩa cấu trúc dữ liệu và các hàm giao tiếp trực tiếp với cơ sở dữ liệu AWS DynamoDB.

| Model | Bảng DynamoDB |
|-------|---------------|
| **`userModel.js`** | Users - username, profile, auth, settings |
| **`callModel.js`** | Calls - call history, status, duration |
| **`awsConfig.js`** | AWS SDK initialization & DynamoDB client |

### `routes/`
Định nghĩa các endpoint API và ánh xạ chúng tới các Controller tương ứng.

| Route File | Endpoints |
|-----------|-----------|
| **`authRoutes.js`** | /api/auth/register, login, verify-otp, forgot-password, reset-password, change-password |
| **`userRoutes.js`** | /api/users/profile, search, update, avatar |
| **`messageRoutes.js`** | /api/v1/messages/send, history, delete, pin, poll |
| **`groupRoutes.js`** | /api/groups/create, members, update, delete |
| **`friendRoutes.js`** | /api/friends/request, accept, reject, list, block |
| **`callRoutes.js`** | /api/calls/initiate, answer, signal, history |
| **`adminRoutes.js`** | /api/admin/stats, users, ban, reset-password |
| **`chatbotRoutes.js`** | /api/chatbot/ask |
| **`notificationRoutes.js`** | /api/notifications/send, history, read |
| **`storyRoutes.js`** | /api/stories/create, view, delete |
| **`postRoutes.js`** | /api/posts/create, comment, like, delete |
| **`searchRoutes.js`** | /api/search/global |
| **`utilsRoutes.js`** | /api/utils/upload, process |

### `services/`
Chứa các logic nghiệp vụ dùng chung hoặc giao tiếp với các dịch vụ đám mây bên ngoài.

| Service | Chức năng |
|---------|----------|
| **`s3Service.js`** | Upload file to AWS S3, generate pre-signed URLs, file deletion |
| **`messageService.js`** | Message normalization, routing, conversation threading, indexing |
| **`callService.js`** | WebRTC setup, ICE candidate management, call state |
| **`fcmService.js`** | Firebase Cloud Messaging, push notifications, token management |

### `socket/`
Quản lý toàn bộ luồng giao tiếp hai chiều thời gian thực (Real-time communication) bằng Socket.IO.

| File | Chức năng |
|------|----------|
| **`index.js`** | Socket.IO initialization, middleware setup, event registration |
| **`chatSocket.js`** | send_message, receive_message, typing_indicator, group_message, friend_request, force_logout, online_status |
| **`callSocket.js`** | call_initiate, call_answer, call_reject, ice_candidate, screen_share, call_end, call_timeout |

### `store/`
Lưu trữ trạng thái tạm thời (In-Memory Store) trên bộ nhớ Server.

| Store | Mục đích |
|-------|---------|
| **`presenceStore.js`** | Track user online/offline, socketId ↔ username mapping, last seen |
| **`activeCalls.js`** | Track active call rooms, participants, call duration |

### `utils/`
Các hàm và cấu hình tiện ích hỗ trợ.
- **`webrtcConfig.js`**: Cấu hình mặc định danh sách máy chủ STUN/TURN hỗ trợ thiết lập luồng P2P WebRTC.

### Tệp cấu hình gốc
- **`server.js`**: Tệp đầu vào khởi chạy ứng dụng Express, cấu hình CORS, kết nối HTTP Server với Socket.IO và nạp toàn bộ Route.
- **`awsConfig.js`**: Khởi tạo đối tượng `DynamoDBDocumentClient` từ AWS SDK v3 để giao tiếp tối ưu với DynamoDB.
- **`.env`**: Tệp cấu hình chứa các biến môi trường nhạy cảm (Cổng, Chuỗi bí mật JWT, Thông tin xác thực AWS).

---

## 🛠️ Hướng dẫn Cài đặt & Khởi chạy

### 1. Yêu cầu hệ thống
- **Node.js**: Phiên bản 18.x trở lên.
- **AWS Account**: Đã thiết lập sẵn các bảng `Users`, `Messages`, `Groups` trên dịch vụ DynamoDB.

### 2. Cài đặt các gói phụ thuộc
Di chuyển vào thư mục backend và cài đặt thư viện:
```bash
cd backend
npm install
```

### 3. Thiết lập Biến môi trường
Tạo một tệp `.env` tại thư mục gốc của `backend`. Xem `.env.example` để tham khảo:

```env
# Server
HOST=0.0.0.0
PORT=3001

# JWT Authentication
JWT_SECRET=your_super_secret_key_here

# AWS Configuration
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
S3_BUCKET_NAME=your_s3_bucket_name

# Email (Nodemailer - for OTP & notifications)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password

# Google Gemini API (for Chatbot)
GEMINI_API_KEY=your_gemini_api_key

# CORS Configuration
FRONTEND_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# WebRTC Configuration
WEBRTC_STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
WEBRTC_TURN_URLS=turn:your-turn-server.com:3478
WEBRTC_TURN_USERNAME=your_turn_username
WEBRTC_TURN_CREDENTIAL=your_turn_credential

# Call Settings
CALL_DEBUG=true
CALLS_TABLE_NAME=Calls
CALL_RING_TIMEOUT_MS=30000
```

### 4. Khởi chạy Server
- **Chế độ Phát triển (Development)**: Tự động tải lại mã nguồn khi có thay đổi nhờ `nodemon`.
```bash
npm run dev
```
- **Chế độ Sản xuất (Production)**:
```bash
npm start
```

---

## 🛡️ Bảo mật & Features Nâng cao

### Security Features
✅ **JWT Authentication** - Token-based authentication với expiration  
✅ **XSS Protection** - Sanitize middleware blocks malicious scripts  
✅ **Rate Limiting** - Anti brute-force (20 req/15min for auth, 300 req/min for API)  
✅ **Password Hashing** - bcryptjs with salting  
✅ **Input Validation** - Server-side validation trên tất cả endpoints  
✅ **Bad Words Filtering** - Content moderation  
✅ **CORS Whitelisting** - Configurable allowed origins  
✅ **SQL Injection Prevention** - DynamoDB query parameterization  
✅ **Session Management** - Multi-device support với force-logout capability  

### Advanced Features
- **Force Logout**: Admin có thể ngắt kết nối tất cả session của user khi ban account hoặc reset password
- **Real-time Notifications**: Socket.IO events cho messaging, calls, friend requests
- **File Handling**: Direct S3 uploads với pre-signed URLs
- **Message History**: Persistent storage trên DynamoDB
- **Call Tracking**: Lưu call history với duration, participants
- **Admin Dashboard**: Real-time statistics, user management

---

## 📊 Database Schema (DynamoDB)

### Users Table
```javascript
{
  username (PK): string,
  password_hash: string,
  email: string,
  phone: string,
  avatar_url: string,
  display_name: string,
  bio: string,
  created_at: timestamp,
  updated_at: timestamp,
  isVerified: boolean,
  isBanned: boolean,
  last_seen: timestamp,
  device_ids: [string],
  blocked_users: [string]
}
```

### Messages Table
```javascript
{
  conversation_id (PK): string,
  message_id (SK): string,
  sender_id: string,
  content: string,
  attachments: [{ url, type, size }],
  status: 'sent' | 'delivered' | 'read',
  created_at: timestamp,
  is_pinned: boolean,
  is_recalled: boolean,
  reactions: { user_id: emoji }
}
```

### Calls Table
```javascript
{
  call_id (PK): string,
  initiator_id: string,
  recipient_id: string,
  type: 'audio' | 'video',
  status: 'ringing' | 'connected' | 'ended' | 'missed',
  started_at: timestamp,
  ended_at: timestamp,
  duration_seconds: number
}
```

---

## 🔗 Real-time Communication (Socket.IO)

### Messaging Events
```javascript
// Send 1-1 message
socket.emit('send_message', { receiver_id, content, attachments })
socket.on('receive_message', (message) => {})

// Typing indicators
socket.emit('typing_indicator', { recipient_id })
socket.on('user_typing', (data) => {})

// Group messages
socket.emit('group_message', { group_id, content })
socket.on('group_message', (message) => {})

// Friend requests
socket.on('friend_request', (request_data) => {})

// Force logout
socket.on('force_logout', () => { window.location.href = '/login' })
```

### Calling Events (WebRTC)
```javascript
// Initiate call
socket.emit('call_initiate', { recipient_id, call_type: 'video' })
socket.on('incoming_call', (call_data) => {})

// Answer/Reject
socket.emit('call_answer', { call_id })
socket.emit('call_reject', { call_id, reason })

// WebRTC Signaling
socket.emit('ice_candidate', { call_id, candidate })
socket.on('ice_candidate', (candidate) => {})`

// Screen sharing
socket.emit('screen_share', { call_id, enabled: true })

// End call
socket.emit('call_end', { call_id })
```

---

## 🧪 Testing API Endpoints

### Using cURL or Postman

**Register**
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "password123"
  }'
```

**Login**
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "password123"
  }'
```

**Get Profile (Authenticated)**
```bash
curl -X GET http://localhost:3001/api/users/profile \
  -H "Authorization: Bearer your_jwt_token_here"
```

---

> [!IMPORTANT]
> **Multi-Device Logout**: Toàn bộ các API riêng tư đều được bảo vệ qua `authMiddleware.js`. Khi admin ban account hoặc reset password, server tự động phát `force_logout` signal qua Socket.IO tới tất cả connected clients, ngắt phiên ngay lập tức mà không cần reload trang.
