# 🚀 OTT Project — Backend Architecture & API Documentation

**Version**: 7.0 | **Last Updated**: 2026-05-24 | **Status**: Production-Ready

Tài liệu này cung cấp cái nhìn toàn diện về kiến trúc hệ thống, chức năng của từng thư mục, tệp tin và hướng dẫn triển khai phía Backend của nền tảng nhắn tin/gọi điện OTT (One-to-One Messaging & Video Call Platform).

---

Link sản phẩm: https://ngochien-ott.duckdns.org/chat

---

## 🎯 Tổng quan Kiến trúc (Overview)

**OTT Backend** là một **REST API + WebSocket server** hiệu năng cao được xây dựng trên Node.js, cung cấp hệ sinh thái hoàn chỉnh cho một siêu ứng dụng:
- ✅ **Real-time Messaging**: Xử lý hàng nghìn tin nhắn đồng thời qua Socket.IO.
- ✅ **WebRTC Calls**: Máy chủ trung chuyển tín hiệu (Signaling Server) cho Video/Audio Calls.
- ✅ **User & Group Management**: Đầy đủ tính năng phân quyền, phân role (Admin/Member).
- ✅ **Advanced Ecosystem**: Hỗ trợ S3 Cloud Storage, Firebase Push Notifications, Gemini AI Chatbot.
- ✅ **Security**: End-to-End Encryption support, JWT Auth, XSS Protection, API Rate Limiting.

**Tech Stack**: Node.js + Express.js + Socket.IO + AWS DynamoDB + S3 + Firebase Admin FCM + Google Gemini AI

---

## 📂 Cấu trúc Thư mục (Directory Structure)

### 1. 🚦 `controllers/` (Xử lý Logic Request)
Chứa toàn bộ logic xử lý các yêu cầu HTTP từ Client, giao tiếp với các Model/Service và trả về JSON.

| Controller | Chức năng chính |
|-----------|----------------|
| **`authController.js`** | Đăng ký, đăng nhập, xác thực OTP qua Email (Nodemailer), quên mật khẩu, quản lý phiên. |
| **`userController.js`** | Quản lý Profile, thay đổi Avatar, tìm kiếm người dùng. |
| **`messageController.js`** | CRUD tin nhắn cá nhân/nhóm, ghim tin, thu hồi tin, tạo Poll (Bình chọn). |
| **`groupController.js`** | Tạo/quản lý Nhóm, thêm/xóa thành viên, cấp quyền Admin. |
| **`friendController.js`** | Gửi/Nhận lời mời kết bạn, quản lý danh sách chặn (Block list). |
| **`callController.js`** | Khởi tạo cuộc gọi WebRTC, quản lý ICE candidates, lưu lịch sử gọi. |
| **`chatbotController.js`** | Tích hợp Google Gemini AI để tự động phản hồi tin nhắn trong nhóm. |
| **`adminController.js`** | Dashboard thống kê lưu lượng tin nhắn, quản lý cấm người dùng (Ban/Unban). |
| **`notificationController.js`**| Đẩy thông báo qua Firebase Cloud Messaging (FCM). |
| **`storyController.js`** | Quản lý vòng đời Story (tin 24h tự hủy), thả cảm xúc Story. |
| **`postController.js`** | Quản lý bảng tin Mạng xã hội, bình luận và thả tim bài viết. |
| **`searchController.js`** | Bộ máy tìm kiếm toàn cục (Global Search) theo keyword. |

### 2. 🛡️ `middlewares/` (Kiểm duyệt Yêu cầu)
Các màng lọc bảo mật trước khi cho phép Request đi sâu vào hệ thống.

| Middleware | Mục đích |
|-----------|---------|
| **`authMiddleware.js`** | Giải mã JWT, kiểm tra trạng thái tài khoản (bị cấm/chưa xác thực). |
| **`socketAuth.js`** | Xác thực Token ngay từ bước bắt tay kết nối Socket.IO. |
| **`sanitize.js`** | Lọc mã độc XSS, chống Script Injection (Sử dụng thư viện `xss` và `bad-words`). |

### 3. 💾 `models/` (Giao tiếp Database)
Lớp giao tiếp trực tiếp với cơ sở dữ liệu phi quan hệ (NoSQL).

| Model/Tệp tin | Chức năng / Bảng DynamoDB |
|-------|---------------|
| **`userModel.js`** | Bảng `Users` - Truy vấn thông tin người dùng. |
| **`callModel.js`** | Bảng `Calls` - Truy vấn và cập nhật trạng thái cuộc gọi. |
| **`awsConfig.js`** | Khởi tạo kết nối bảo mật tới AWS DynamoDB bằng `SDK v3`. |

### 4. 🌐 `routes/` (Điều hướng API)
Ánh xạ các HTTP method (GET, POST, PUT, DELETE) tới Controllers tương ứng.
*Hệ thống bao gồm 13 tệp Route map 1-1 với Controllers: `authRoutes.js`, `userRoutes.js`, `messageRoutes.js`, `groupRoutes.js`, `friendRoutes.js`, `callRoutes.js`, `adminRoutes.js`, `chatbotRoutes.js`, `notificationRoutes.js`, `storyRoutes.js`, `postRoutes.js`, `searchRoutes.js`.*

### 5. 🛠️ `services/` (Dịch vụ Lõi)
Các module nghiệp vụ phức tạp hoặc giao tiếp với bên thứ ba.

| Service | Chức năng |
|---------|----------|
| **`s3Service.js`** | Upload file/media lên AWS S3, tạo Pre-signed URLs bảo mật thời hạn ngắn. |
| **`messageService.js`** | Điều hướng tin nhắn, xử lý phân trang tin nhắn (Pagination). |
| **`callService.js`** | Quản lý trạng thái thiết lập WebRTC, dọn dẹp kết nối chết. |
| **`fcmService.js`** | Giao tiếp với API của Firebase Admin để đẩy push notification về thiết bị di động/trình duyệt. |

### 6. ⚡ `socket/` (Real-time Engine)
"Trái tim" của hệ thống Real-time.

| File | Chức năng |
|------|----------|
| **`index.js`** | Khởi tạo Server Socket.IO, gắn cấu hình CORS và SocketAuth Middleware. |
| **`chatSocket.js`** | Xử lý `send_message`, `typing_indicator`, `group_message`, `force_logout`, `online_status`. |
| **`callSocket.js`** | Làm trung gian truyền WebRTC Signaling (`call_initiate`, `call_answer`, `ice_candidate`, `screen_share`). |

### 7. 🧠 `store/` (In-memory Database)
| Store | Mục đích |
|-------|---------|
| **`presenceStore.js`**| Theo dõi ai đang Online/Offline, map `socketId ↔ username`, ghi nhận `Last Seen`. |
| **`activeCalls.js`** | Theo dõi các phòng gọi video đang diễn ra để tính toán thời lượng. |

---

## 📊 Cấu trúc Dữ liệu (DynamoDB Schema)

Dự án thiết kế cấu trúc NoSQL tối ưu cho tốc độ đọc/ghi siêu tốc.

👤 **Users Table**
```javascript
{
  username (PK): string,
  password_hash: string,
  email: string,
  avatar_url: string,
  display_name: string,
  isVerified: boolean,
  isBanned: boolean,
  last_seen: timestamp,
  friends: [string],
  blocked_users: [string]
}
```

💬 **Messages Table**
```javascript
{
  conversation_id (PK): string, // Format: "userA_userB" hoặc "groupID"
  message_id (SK): string,
  sender_id: string,
  content: string,
  msgType: 'text' | 'image' | 'video' | 'file' | 'poll' | 'voice',
  attachments: [{ url, type, size }],
  created_at: timestamp,
  is_recalled: boolean,
  reactions: { user_id: emoji }
}
```

📞 **Calls Table**
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

## 🔗 Luồng sự kiện Socket.IO (WebRTC & Chat)

**1. Gửi tin nhắn 1-1**
```javascript
// 1. Client A phát sự kiện gửi tin nhắn
socket.emit('send_message', { receiver_id, content, attachments })
// 2. Server phát sự kiện cho Client B
socket.on('receive_message', (message) => {})
```

**2. Thiết lập cuộc gọi Video (WebRTC Signaling)**
```javascript
// 1. A gọi B
socket.emit('call_initiate', { recipient_id, call_type: 'video' })
// 2. B nhận chuông
socket.on('incoming_call', (call_data) => {})
// 3. B trả lời
socket.emit('call_answer', { call_id })
// 4. A & B trao đổi ICE Candidates để kết nối P2P (Trực tiếp không qua Server)
socket.emit('ice_candidate', { call_id, candidate })
socket.on('ice_candidate', (candidate) => {})
```

---

## 🚀 Hướng dẫn Cài đặt & Khởi chạy

### 1. Yêu cầu hệ thống
- **Node.js**: Phiên bản 18.x trở lên.
- **AWS**: Đã cấu hình IAM Role, DynamoDB Tables và S3 Bucket.

### 2. Cài đặt các gói phụ thuộc
```bash
cd CNM_DoAnMonHoc_Backend
npm install
```

### 3. Thiết lập Biến môi trường
Tạo một tệp `.env` tại thư mục gốc của `backend` (Sao chép từ `.env.example`):
```env
PORT=3001
JWT_SECRET=super_secret_string

# AWS Credentials
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
S3_BUCKET_NAME=my_bucket_name

# Email for OTP
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password

# Gemini AI
GEMINI_API_KEY=xxx
```

### 4. Khởi chạy Server
- **Chế độ Dev (Tự động reload nhờ Nodemon)**:
```bash
npm run dev
```
- **Chế độ Sản xuất (Production)**:
```bash
npm start
```

---

> [!IMPORTANT]
> **Cơ chế Bảo mật Kép (Force Logout)**: Toàn bộ các API riêng tư đều được bảo vệ qua `authMiddleware.js`. Điểm đặc biệt của hệ thống là khi Admin cấm tài khoản (Ban) hoặc khi người dùng đổi mật khẩu, Server không chỉ vô hiệu hóa Token mà còn chủ động phát tín hiệu `force_logout` qua Socket.IO tới tất cả các thiết bị đang đăng nhập, ép văng tài khoản ngay lập tức theo thời gian thực (Real-time) để bảo vệ dữ liệu.
