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

module.exports = router;
