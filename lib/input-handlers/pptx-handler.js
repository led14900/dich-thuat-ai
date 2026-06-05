const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');

class PptxHandler {
  /**
   * Extracts text from a PPTX file.
   * @param {string} filePath - Path to the PPTX file
   * @returns {Promise<string>} - Extracted text (Markdown format)
   */
  static async extractText(filePath) {
    return new Promise((resolve, reject) => {
      try {
        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();
        const parser = new XMLParser({
          ignoreAttributes: true,
        });

        // Find all slide xml files
        const slideEntries = zipEntries.filter(entry => entry.entryName.match(/ppt\/slides\/slide\d+\.xml/));
        
        // Sort by slide number
        slideEntries.sort((a, b) => {
          const numA = parseInt(a.entryName.match(/slide(\d+)\.xml/)[1]);
          const numB = parseInt(b.entryName.match(/slide(\d+)\.xml/)[1]);
          return numA - numB;
        });

        let allText = '';
        
        slideEntries.forEach((entry, idx) => {
          const xmlData = zip.readAsText(entry);
          const jsonObj = parser.parse(xmlData);
          
          let slideText = '';
          this._extractTextNodes(jsonObj, (text) => {
            if (text && text.trim()) {
              slideText += text.trim() + '\n';
            }
          });

          if (slideText) {
            allText += `### Slide ${idx + 1}\n\n${slideText}\n\n---\n\n`;
          }
        });

        resolve(allText.trim());
      } catch (err) {
        reject(new Error(`Lỗi đọc file PPTX: ${err.message}`));
      }
    });
  }

  static _extractTextNodes(obj, cb) {
    if (typeof obj === 'string') {
      cb(obj);
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach(item => this._extractTextNodes(item, cb));
      return;
    }
    if (typeof obj === 'object' && obj !== null) {
      for (const key of Object.keys(obj)) {
        if (key === 'a:t') {
          cb(obj[key]);
        } else {
          this._extractTextNodes(obj[key], cb);
        }
      }
    }
  }

  /**
   * Returns metadata about the PPTX.
   * @param {string} filePath 
   */
  static getMetadata(filePath) {
    return {
      type: 'pptx',
      totalPages: 1, // We process the entire PPTX as a single "page" for translation
      originalPath: filePath
    };
  }
}

module.exports = PptxHandler;
