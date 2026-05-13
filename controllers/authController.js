// backend/controllers/authController.js

const User = require('../models/userModel');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const AWS = require('aws-sdk');
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
    } catch (err) { res.status(500).json({ message: err.message }); }
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

// 3. Đăng nhập
exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findByUsername(username);
        if (!user || !user.isVerified) return res.status(401).json({ message: "Tài khoản sai hoặc chưa xác thực!" });
        if (user.isBanned) return res.status(403).json({ message: "Tài khoản đã bị khóa!" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Sai mật khẩu!" });

        const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.json({ token, username: user.username, displayName: user.displayName, role: user.role, avatar: user.avatar });
    } catch (err) { res.status(500).json({ message: "Lỗi đăng nhập" }); }
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