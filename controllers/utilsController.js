const axios = require('axios');

exports.getLinkPreview = async (req, res) => {
    let { url } = req.query;
    try {
        if (!url) return res.status(400).json({ error: "URL is required" });

        if (!/^https?:\/\//i.test(url)) {
            url = 'https://' + url;
        }

        // Clean URL (remove trailing dots or spaces)
        url = url.replace(/\.+$/, '').trim();

        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Referer': 'https://www.google.com/'
            },
            timeout: 10000,
            maxContentLength: 2 * 1024 * 1024, // 2MB
            maxRedirects: 10
        });

        const html = response.data;
        if (typeof html !== 'string') {
            throw new Error("Invalid response format");
        }
        
        const getMeta = (nameOrProp) => {
            const patterns = [
                new RegExp(`<meta[^>]+(?:property|name)=["']${nameOrProp}["'][^>]+content=["']([^"']+)["']`, 'i'),
                new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${nameOrProp}["']`, 'i')
            ];
            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match) return match[1];
            }
            return null;
        };

        const title = getMeta('og:title') || getMeta('twitter:title') || (html.match(/<title>([^<]+)<\/title>/i) || [])[1];
        const description = getMeta('og:description') || getMeta('twitter:description') || getMeta('description');
        let image = getMeta('og:image') || getMeta('twitter:image');

        if (image && image.startsWith('/')) {
            try {
                const urlObj = new URL(url);
                image = `${urlObj.protocol}//${urlObj.hostname}${image}`;
            } catch(e) {}
        }

        res.json({
            title: title ? title.trim() : url,
            description: description ? description.trim() : "Nhấn để xem chi tiết liên kết.",
            image: image,
            url: url
        });

    } catch (error) {
        console.error(`[LinkPreview] Fail: ${url} -> ${error.message}`);
        // Luôn trả về 200 kèm dữ liệu tối thiểu để Frontend hiển thị được
        res.json({
            title: url,
            description: "Liên kết này không hỗ trợ xem trước hoặc bị chặn bởi máy chủ nguồn.",
            url: url
        });
    }
};
