const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');

router.get('/global', searchController.globalSearch);

module.exports = router;
