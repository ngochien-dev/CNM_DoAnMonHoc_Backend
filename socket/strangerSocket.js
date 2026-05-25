let waitingStrangers = [];
let activeStrangerRooms = {};

module.exports = function registerStrangerSocket({ io, socket }) {
    
    socket.on('find_stranger', (data) => {
        const username = data?.username || 'Anonymous';
        
        // Loại bỏ khỏi hàng đợi nếu đã có
        waitingStrangers = waitingStrangers.filter(u => u.socketId !== socket.id);
        
        // Rời phòng cũ nếu đang trong phòng
        if (activeStrangerRooms[socket.id]) {
            const oldRoom = activeStrangerRooms[socket.id];
            socket.leave(oldRoom);
            socket.to(oldRoom).emit('stranger_left');
            delete activeStrangerRooms[socket.id];
        }

        if (waitingStrangers.length > 0) {
            // Tìm thấy người thứ 2
            const partner = waitingStrangers.shift();
            
            // Tránh ghép đôi với chính mình (nếu bị lỗi do mở 2 tab)
            if (partner.socketId === socket.id) return;

            const roomId = `stranger_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            
            socket.join(roomId);
            const partnerSocket = io.sockets.sockets.get(partner.socketId);
            
            if (partnerSocket) {
                partnerSocket.join(roomId);
                
                activeStrangerRooms[socket.id] = roomId;
                activeStrangerRooms[partner.socketId] = roomId;
                
                // Gửi sự kiện ghép đôi thành công cho cả 2
                io.to(roomId).emit('stranger_matched', { roomId });
            } else {
                // Partner đã disconnect, đưa người hiện tại vào hàng đợi
                waitingStrangers.push({ socketId: socket.id, username });
            }
        } else {
            // Chờ người khác
            waitingStrangers.push({ socketId: socket.id, username });
        }
    });

    socket.on('stranger_message', (data) => {
        const roomId = activeStrangerRooms[socket.id];
        if (roomId) {
            // Phát tín hiệu cho người còn lại trong phòng (to)
            socket.to(roomId).emit('receive_stranger_message', {
                _id: Date.now().toString(),
                sender_id: 'stranger',
                content: data.content,
                created_at: new Date().toISOString()
            });
        }
    });

    socket.on('skip_stranger', () => {
        const roomId = activeStrangerRooms[socket.id];
        if (roomId) {
            socket.leave(roomId);
            socket.to(roomId).emit('stranger_left');
            
            // Xóa theo dõi phòng này cho cả 2
            for (let [sId, rId] of Object.entries(activeStrangerRooms)) {
                if (rId === roomId) {
                    delete activeStrangerRooms[sId];
                    const pSocket = io.sockets.sockets.get(sId);
                    if (pSocket) pSocket.leave(roomId);
                }
            }
        } else {
            // Nếu đang ở hàng đợi thì thoát hàng đợi
            waitingStrangers = waitingStrangers.filter(u => u.socketId !== socket.id);
        }
    });

    // Khi ngắt kết nối trình duyệt
    socket.on('disconnect', () => {
        waitingStrangers = waitingStrangers.filter(u => u.socketId !== socket.id);
        const roomId = activeStrangerRooms[socket.id];
        if (roomId) {
            socket.to(roomId).emit('stranger_left');
            delete activeStrangerRooms[socket.id];
        }
    });
};
