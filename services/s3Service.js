const AWS = require('aws-sdk');
require('dotenv').config();

// Cấu hình AWS S3 sử dụng AWS SDK v2 (đã có sẵn trong package.json)
const s3 = new AWS.S3({
    region: 'ap-southeast-2', // Hoặc region của bạn
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

exports.uploadBase64File = async (base64String, fileName, fileType) => {
    try {
        let base64Data = base64String;
        let contentType = 'application/octet-stream';
        
        // Tách header của chuỗi base64 (vd: "data:image/png;base64,")
        if (base64String.includes(';base64,')) {
            const parts = base64String.split(';base64,');
            contentType = parts[0].split(':')[1];
            base64Data = parts[1];
        }
        
        // Chuyển base64 thành Buffer
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Tạo tên file duy nhất để tránh trùng lặp
        const timestamp = Date.now();
        // Xóa các ký tự đặc biệt khỏi tên file gốc
        const safeFileName = fileName ? fileName.replace(/[^a-zA-Z0-9.-]/g, '_') : 'file';
        const uniqueFileName = `${timestamp}-${safeFileName}`;
        
        const params = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: `uploads/${uniqueFileName}`,
            Body: buffer,
            ContentType: contentType,
            // ACL: 'public-read' // Mở comment dòng này nếu bucket của bạn không chặn ACL
        };
        
        const result = await s3.upload(params).promise();
        return result.Location; // Trả về S3 URL
    } catch (error) {
        console.error("S3 Upload Error:", error);
        throw error;
    }
};
