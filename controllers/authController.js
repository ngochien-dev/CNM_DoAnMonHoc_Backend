const User = require('../models/userModel');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

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
            subject: "Mã OTP xác thực OTT Project",
            html: `<h3>Chào ${displayName}!</h3><p>Mã OTP của bạn là: <b>${otp}</b></p>`
        });

        res.status(200).json({ message: "OTP đã gửi!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.verify = async (req, res) => {
    try {
        const { username, otp } = req.body;
        const user = await User.findByUsername(username);
        if (user && user.otp === otp) {
            await User.verifyUser(username);
            res.json({ message: "Xác thực thành công!" });
        } else {
            res.status(400).json({ message: "Mã OTP sai rồi bro!" });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findByUsername(username);
        if (!user || !user.isVerified) return res.status(401).json({ message: "Tài khoản sai hoặc chưa xác thực!" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Sai mật khẩu!" });

        const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.json({ token, username: user.username, displayName: user.displayName, role: user.role });
    } catch (err) { res.status(500).json({ error: "Lỗi đăng nhập" }); }
};