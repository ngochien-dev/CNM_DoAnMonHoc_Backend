# 🚀 OTT Project — Backend Architecture & API Documentation

Tài liệu này cung cấp cái nhìn toàn diện về kiến trúc hệ thống, chức năng của từng thư mục, tệp tin và hướng dẫn triển khai phía Backend của nền tảng nhắn tin/gọi điện OTT.

---

## 📂 Cấu trúc thư mục (Directory Structure)

Dưới đây là chi tiết vai trò của từng thư mục và tệp tin mã nguồn trong hệ thống Backend:

### `controllers/`
Chứa toàn bộ logic xử lý các yêu cầu HTTP từ Client, giao tiếp với các Model/Service và trả về phản hồi (Response) dạng JSON.
- **`adminController.js`**: Xử lý logic dành cho Quản trị viên (Admin) bao gồm lấy số liệu thống kê tổng quan (lưu lượng tin nhắn 7 ngày, số lượng tệp đính kèm, tổng số user/group) và quản lý tài khoản (xem danh sách, khóa/mở khóa tài khoản, đặt lại mật khẩu mặc định).
- **`authController.js`**: Quản lý luồng xác thực người dùng bao gồm đăng ký, đăng nhập, xác thực mã OTP, quên mật khẩu và đổi mật khẩu. Có cơ chế tự động ngắt kết nối các thiết bị khác khi mật khẩu thay đổi.
- **`callController.js`**: Quản lý các phiên WebRTC/Cuộc gọi (tạo tín hiệu kết nối, xác thực token phòng gọi).
- **`chatbotController.js`**: Tích hợp xử lý truy vấn từ Chatbot thông minh, hỗ trợ trả lời tự động cho người dùng.
- **`friendController.js`**: Xử lý nghiệp vụ bạn bè (gửi lời mời kết bạn, chấp nhận, từ chối, hủy kết bạn, lấy danh sách bạn bè).
- **`groupController.js`**: Quản lý các nhóm chat (tạo nhóm, thêm/xóa thành viên, rời nhóm, lấy danh sách nhóm).
- **`messageController.js`**: Quản lý tin nhắn (lấy lịch sử tin nhắn, gửi tin có đính kèm file base64/S3, thu hồi tin nhắn, ghim tin nhắn, tạo và bỏ phiếu bình chọn Poll).
- **`userController.js`**: Xử lý logic hồ sơ người dùng (tìm kiếm người dùng, xem và cập nhật thông tin cá nhân, thay đổi ảnh đại diện).

### `middlewares/`
Các hàm trung gian kiểm tra và xác thực yêu cầu trước khi chuyển tiếp đến Controller chính.
- **`authMiddleware.js`**: Kiểm tra và giải mã JWT token (Bearer Token) từ HTTP Header. Tự động từ chối và ngắt kết nối nếu tài khoản chưa được xác thực (`isVerified: false`) hoặc đã bị Admin khóa (`isBanned: true`).
- **`socketAuth.js`**: Middleware chuyên dụng để xác thực tính hợp lệ của token khi Client khởi tạo kết nối Socket.IO thời gian thực.

### `models/`
Định nghĩa cấu trúc dữ liệu và các hàm giao tiếp trực tiếp với cơ sở dữ liệu AWS DynamoDB.
- **`userModel.js`**: Quản lý bảng `Users` (tìm kiếm theo username, tạo mới, cập nhật trạng thái).
- **`callModel.js`**: Quản lý thông tin và trạng thái các phiên gọi điện.
- **`awsConfig.js`**: Cấu hình khởi tạo và kết nối AWS SDK cho các Model.

### `routes/`
Định nghĩa các endpoint API và ánh xạ chúng tới các Controller tương ứng.
- **`adminRoutes.js`**: Các endpoint quản trị (`/api/admin/stats`, `/api/admin/users`, `/api/admin/users/toggle-status`, `/api/admin/users/reset-password`).
- **`authRoutes.js`**: Các endpoint xác thực (`/api/auth/register`, `/api/auth/login`, `/api/auth/verify-otp`, `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/change-password`).
- **`callRoutes.js`**: Các endpoint quản lý cuộc gọi WebRTC.
- **`chatbotRoutes.js`**: Endpoint giao tiếp với Chatbot (`/api/chatbot/ask`).
- **`friendRoutes.js`**: Các endpoint quản lý danh sách bạn bè.
- **`groupRoutes.js`**: Các endpoint quản lý nhóm chat.
- **`messageRoutes.js`**: Các endpoint quản lý tin nhắn và bình chọn.
- **`userRoutes.js`**: Các endpoint truy xuất và cập nhật hồ sơ người dùng.

### `services/`
Chứa các logic nghiệp vụ dùng chung hoặc giao tiếp với các dịch vụ đám mây bên ngoài.
- **`callService.js`**: Xử lý nghiệp vụ chuyên sâu hỗ trợ luồng kết nối WebRTC.
- **`messageService.js`**: Xử lý nghiệp vụ chuẩn hóa, định tuyến và phân tích tin nhắn.
- **`s3Service.js`**: Dịch vụ hỗ trợ tải tệp tin (hình ảnh, tài liệu, video) lên AWS S3 và lấy URL truy cập an toàn.

### `socket/`
Quản lý toàn bộ luồng giao tiếp hai chiều thời gian thực (Real-time communication) bằng Socket.IO.
- **`index.js`**: Điểm neo khởi tạo Socket.IO server, tích hợp middleware `socketAuth` và liên kết các module sự kiện.
- **`chatSocket.js`**: Quản lý các sự kiện nhắn tin (gửi/nhận tin nhắn, cập nhật danh sách nhóm, phát thông báo kết bạn, phát tín hiệu `force_logout` để ngắt phiên làm việc từ xa).
- **`callSocket.js`**: Quản lý tín hiệu WebRTC thời gian thực (gọi điện 1-1, chấp nhận/từ chối cuộc gọi, chuyển tiếp ICE candidate, chia sẻ màn hình).

### `store/`
Lưu trữ trạng thái tạm thời (In-Memory Store) trên bộ nhớ Server.
- **`presenceStore.js`**: Theo dõi trạng thái trực tuyến (Online/Offline) của người dùng và ánh xạ `socketId` với `username`.
- **`activeCalls.js`**: Theo dõi danh sách các phòng gọi đang hoạt động trong thời gian thực.

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
Tạo một tệp `.env` tại thư mục gốc của `backend` với định dạng:
```env
PORT=5000
JWT_SECRET=chuoi_bi_mat_jwt_cua_ban
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=ma_truy_cap_aws_cua_ban
AWS_SECRET_ACCESS_KEY=ma_bi_mat_aws_cua_ban
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

## 🛡️ Cơ chế Bảo mật & Quản lý Phiên Nâng cao

> [!IMPORTANT]
> - **Xác thực Đa tầng**: Toàn bộ các API riêng tư đều được bảo vệ nghiêm ngặt qua `authMiddleware.js`.
> - **Ngắt kết nối Tức thời (Force Logout)**: Hệ thống được thiết kế để tự động phát tín hiệu ngắt kết nối qua Socket.IO tới các thiết bị mục tiêu ngay khi Quản trị viên thực hiện thao tác **Khóa tài khoản** hoặc **Đặt lại mật khẩu**, đảm bảo chấm dứt quyền truy cập trái phép ngay lập tức mà không cần tải lại trang.
