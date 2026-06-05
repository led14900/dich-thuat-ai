const fs = require('fs/promises');

class ImageHandler {
  /**
   * Reads an image file and returns its buffer.
   * @param {string} filePath - Path to the image file
   * @returns {Promise<Buffer>} - Image buffer
   */
  static async extractBuffer(filePath) {
    try {
      const buffer = await fs.readFile(filePath);
      return buffer;
    } catch (err) {
      throw new Error(`Lỗi đọc file ảnh: ${err.message}`);
    }
  }

  /**
   * Returns metadata about the image.
   * @param {string} filePath 
   */
  static getMetadata(filePath) {
    return {
      type: 'image',
      totalPages: 1, // An image is treated as a single page
      originalPath: filePath
    };
  }
}

module.exports = ImageHandler;
