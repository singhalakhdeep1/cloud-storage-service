const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;

    console.error(err);

    // Multer file size error
    if (err.code === 'LIMIT_FILE_SIZE') {
        error.message = 'File size exceeds the limit';
        error.statusCode = 400;
    }

    // Multer unexpected field
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        error.message = 'Unexpected field in file upload';
        error.statusCode = 400;
    }

    res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

module.exports = errorHandler;
