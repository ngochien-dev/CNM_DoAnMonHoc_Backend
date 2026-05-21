const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');

router.get('/all', groupController.getAllGroups);
router.post('/create', groupController.createGroup);
router.post('/request', groupController.requestJoin);
router.post('/approve', groupController.approveJoin);
router.post('/manage', groupController.manageGroup);
router.post('/remove-member', groupController.removeMember);
router.post('/role', groupController.updateRole);
router.post('/rename', groupController.renameGroup);
router.post('/transfer-ownership', groupController.transferOwnership);
router.post('/invite', groupController.inviteToGroup);
router.post('/update-avatar', groupController.updateGroupAvatar);

// New Routes for Invite Links & Moderation
router.post('/invite-link/toggle', groupController.toggleInviteLink);
router.post('/invite-link/reset', groupController.resetInviteLink);
router.post('/join-by-invite', groupController.joinByInvite);
router.post('/mute', groupController.muteMember);
router.post('/unmute', groupController.unmuteMember);
router.post('/toggle-channel', groupController.toggleChannelMode);

module.exports = router;
