const express = require('express');
const router = express.Router();
const utilsController = require('../controllers/utilsController');

router.get('/link-preview', utilsController.getLinkPreview);

module.exports = router;
