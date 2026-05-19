// backend/controllers/authController.js

require('dotenv').config();
const User = require('../models/userModel');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const AWS = require('aws-sdk');
const awsConfig = {
    region: process.env.AWS_REGION || 'ap-southeast-1',
};

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    awsConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
}

AWS.config.update(awsConfig);
const docClient = new AWS.DynamoDB.DocumentClient();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { 
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
    }
});

// 1. Đăng ký & Gửi OTP
exports.register = async (req, res) => {
    try {
        const { username, password, email, displayName } = req.body;
        const existing = await User.findByUsername(username);
        if (existing) return res.status(400).json({ message: "Username đã tồn tại!" });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedPassword = await bcrypt.hash(password, 10);

        await User.create({ username, password: hashedPassword, email, displayName, otp });

        await transporter.sendMail({
            from: '"OTT Community" <no-reply@ott.com>',
            to: email,
            subject: "Mã OTP xác nhận đăng ký",
            html: `<h3>Chào ${displayName}!</h3><p>Mã OTP của bạn là: <b>${otp}</b></p>`
        });
        res.status(200).json({ message: "OTP đã gửi!" });
    } catch (err) {
        console.error('Register API error:', {
            name: err.name,
            message: err.message,
            code: err.code,
            statusCode: err.$metadata?.httpStatusCode || err.statusCode,
            requestId: err.$metadata?.requestId || err.requestId,
            region: process.env.AWS_REGION || 'ap-southeast-1',
            tableName: 'Users',
            stack: err.stack,
        });
        res.status(500).json({ message: err.message });
    }
};

// 2. Xác thực OTP đăng ký
exports.verify = async (req, res) => {
    try {
        const { username, otp } = req.body;
        const user = await User.findByUsername(username);
        if (user && user.otp === otp) {
            await User.verifyUser(username);
            res.json({ message: "Xác thực thành công!" });
        } else {
            res.status(400).json({ message: "Mã OTP không chính xác!" });
        }
    } catch (err) { res.status(500).json({ message: err.message }); }
};

// Helper to parse User-Agent
function parseUserAgent(ua) {
    if (!ua) return "Thiết bị không xác định";
    let os = "Không rõ OS";
    let browser = "Không rõ trình duyệt";

    if (ua.includes("Windows")) os = "Windows";
    else if (ua.includes("Macintosh")) os = "macOS";
    else if (ua.includes("Linux")) os = "Linux";
    else if (ua.includes("Android")) os = "Android";
    else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

    if (ua.includes("Firefox")) browser = "Firefox";
    else if (ua.includes("Edg")) browser = "Edge";
    else if (ua.includes("Chrome")) browser = "Chrome";
    else if (ua.includes("Safari")) browser = "Safari";
    else if (ua.includes("Opera")) browser = "Opera";

    return `${os} (${browser})`;
}

// Helper to register active session
async function registerActiveSession(user, req) {
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const newSession = {
        sessionId,
        device: parseUserAgent(req.headers['user-agent']),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1',
        loginAt: new Date().toISOString()
    };
    const activeSessions = user.activeSessions || [];
    const updatedSessions = [...activeSessions.slice(-9), newSession]; // keep max 10
    
    await docClient.update({
        TableName: 'Users',
        Key: { username: user.username },
        UpdateExpression: "set activeSessions = :s",
        ExpressionAttributeValues: { ":s": updatedSessions }
    }).promise();
    
    return sessionId;
}

// 3. Đăng nhập
exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findByUsername(username);
        if (!user || !user.isVerified) return res.status(401).json({ message: "Tài khoản sai hoặc chưa xác thực!" });
        if (user.isBanned) return res.status(403).json({ message: "Tài khoản đã bị khóa!" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Sai mật khẩu!" });

        // P2: Check for 2FA
        if (user.is2FAEnabled) {
            const twoFAOtp = Math.floor(100000 + Math.random() * 900000).toString();
            await docClient.update({
                TableName: 'Users', Key: { username: user.username },
                UpdateExpression: "set otp = :o, twoFAExpires = :e",
                ExpressionAttributeValues: { 
                    ":o": twoFAOtp,
                    ":e": Date.now() + 5 * 60 * 1000 // 5 mins
                }
            }).promise();

            // Send 2FA code via email
            await transporter.sendMail({
                from: '"OTT Security" <security@ott.com>',
                to: user.email,
                subject: "Mã xác thực 2 lớp (2FA)",
                html: `<p>Mã xác thực của bạn là: <b>${twoFAOtp}</b>. Mã này có hiệu lực trong 5 phút.</p>`
            }).catch(e => console.error("Email send error:", e));

            return res.json({ requires2FA: true, username: user.username, email: user.email });
        }

        const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '1d' });
        const sessionId = await registerActiveSession(user, req);
        res.json({ token, username: user.username, displayName: user.displayName, role: user.role, avatar: user.avatar, sessionId });
    } catch (err) { res.status(500).json({ message: "Lỗi đăng nhập" }); }
};

exports.verify2FA = async (req, res) => {
    try {
        const { username, otp } = req.body;
        const user = await User.findByUsername(username);
        
        if (!user || user.otp !== otp || Date.now() > user.twoFAExpires) {
            return res.status(401).json({ message: "Mã xác thực không đúng hoặc đã hết hạn!" });
        }

        // Clear OTP after success
        await docClient.update({
            TableName: 'Users', Key: { username },
            UpdateExpression: "remove otp, twoFAExpires"
        }).promise();

        const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '1d' });
        const sessionId = await registerActiveSession(user, req);
        res.json({ token, username: user.username, displayName: user.displayName, role: user.role, avatar: user.avatar, sessionId });
    } catch (err) { res.status(500).json({ message: "Lỗi xác thực 2FA" }); }
};

// 4. Quên mật khẩu (Gửi OTP)
exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const result = await docClient.scan({
            TableName: 'Users',
            FilterExpression: "email = :e",
            ExpressionAttributeValues: { ":e": email }
        }).promise();

        if (result.Count === 0) return res.status(404).json({ message: "Email chưa đăng ký!" });

        const user = result.Items[0];
        const newOtp = Math.floor(100000 + Math.random() * 900000).toString();

        await docClient.update({
            TableName: 'Users', Key: { username: user.username },
            UpdateExpression: "set otp = :o",
            ExpressionAttributeValues: { ":o": newOtp }
        }).promise();

        await transporter.sendMail({
            from: '"OTT Support"',
            to: email,
            subject: "Mã OTP khôi phục mật khẩu",
            html: `<p>Mã OTP khôi phục của bạn là: <b>${newOtp}</b></p>`
        });
        res.json({ message: "OTP đã gửi!" });
    } catch (err) { res.status(500).json({ message: err.message }); }
};

// 5. Đặt lại mật khẩu (Reset bằng OTP)
exports.resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const result = await docClient.scan({
            TableName: 'Users',
            FilterExpression: "email = :e AND otp = :o",
            ExpressionAttributeValues: { ":e": email, ":o": otp }
        }).promise();

        if (result.Count === 0) return res.status(400).json({ message: "OTP hoặc Email không đúng!" });

        const user = result.Items[0];
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await docClient.update({
            TableName: 'Users', Key: { username: user.username },
            UpdateExpression: "set password = :p remove otp",
            ExpressionAttributeValues: { ":p": hashedPassword }
        }).promise();
        
        if (req.app.get('io')) {
            req.app.get('io').emit('force_logout', { username: user.username, reason: 'password_reset' });
        }
        res.json({ message: "Đổi mật khẩu thành công!" });
    } catch (err) { res.status(500).json({ message: err.message }); }
};

// 6. Đổi mật khẩu (Khi đang trong app)
exports.changePassword = async (req, res) => {
    try {
        const { username, oldPassword, newPassword } = req.body;
        const user = await User.findByUsername(username);
        
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(400).json({ message: "Mật khẩu cũ không chính xác!" });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await docClient.update({
            TableName: 'Users', Key: { username },
            UpdateExpression: "set password = :p",
            ExpressionAttributeValues: { ":p": hashedPassword }
        }).promise();
        
        if (req.app.get('io')) {
            req.app.get('io').emit('force_logout', { username, reason: 'password_changed' });
        }
        res.json({ success: true, message: "Đổi mật khẩu thành công!" });
    } catch (err) { res.status(500).json({ message: err.message }); }
};
