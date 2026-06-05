const mammoth = require('mammoth');

class DocxHandler {
  /**
   * Extracts text/markdown from a DOCX file.
   * @param {string} filePath - Path to the DOCX file
   * @returns {Promise<string>} - Extracted markdown text
   */
  static async extractText(filePath) {
    try {
      // mammoth extracts raw text or HTML. We can extract raw text for translation.
      // Or we can extract HTML and convert to basic Markdown.
      const result = await mammoth.extractRawText({ path: filePath });
      const text = result.value;
      return text;
    } catch (err) {
      throw new Error(`Lỗi đọc file DOCX: ${err.message}`);
    }
  }

  /**
   * Returns metadata about the DOCX.
   * @param {string} filePath 
   */
  static getMetadata(filePath) {
    return {
      type: 'docx',
      totalPages: 1, // We process the entire DOCX as a single "page" or chunk for simplicity in MVP
      originalPath: filePath
    };
  }
}

module.exports = DocxHandler;
