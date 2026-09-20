/**
 * settings-ui.js — Settings view logic for AI Translate
 * Sole Provider: Gemini Enterprise Agent Platform (Vertex AI)
 *
 * Flow:
 *   1. User enters SA JSON + Project ID + Region
 *   2. Click "Xác thực" → testConnection + listModels → show dropdown
 *   3. User selects model → "Lưu cài đặt"
 */
window.SettingsUI = (() => {

  // Complete list of GCP regions that support Vertex AI
  const VERTEX_REGIONS = [
    { value: 'global', label: 'global (Global Endpoint — Dynamic routing)' },
    { value: 'us-central1', label: 'us-central1 (Iowa, USA) — Khuyến nghị' },
    { value: 'us-east1', label: 'us-east1 (South Carolina, USA)' },
    { value: 'us-east4', label: 'us-east4 (Northern Virginia, USA)' },
    { value: 'us-east5', label: 'us-east5 (Columbus, USA)' },
    { value: 'us-south1', label: 'us-south1 (Dallas, USA)' },
    { value: 'us-west1', label: 'us-west1 (Oregon, USA)' },
    { value: 'us-west4', label: 'us-west4 (Las Vegas, USA)' },
    { value: 'northamerica-northeast1', label: 'northamerica-northeast1 (Montreal)' },
    { value: 'northamerica-northeast2', label: 'northamerica-northeast2 (Toronto)' },
    { value: 'southamerica-east1', label: 'southamerica-east1 (São Paulo)' },
    { value: 'europe-central2', label: 'europe-central2 (Warsaw)' },
    { value: 'europe-north1', label: 'europe-north1 (Finland)' },
    { value: 'europe-southwest1', label: 'europe-southwest1 (Madrid)' },
    { value: 'europe-west1', label: 'europe-west1 (Belgium)' },
    { value: 'europe-west2', label: 'europe-west2 (London)' },
    { value: 'europe-west3', label: 'europe-west3 (Frankfurt)' },
    { value: 'europe-west4', label: 'europe-west4 (Netherlands)' },
    { value: 'europe-west6', label: 'europe-west6 (Zurich)' },
    { value: 'europe-west8', label: 'europe-west8 (Milan)' },
    { value: 'europe-west9', label: 'europe-west9 (Paris)' },
    { value: 'me-central1', label: 'me-central1 (Doha)' },
    { value: 'me-west1', label: 'me-west1 (Tel Aviv)' },
    { value: 'asia-east1', label: 'asia-east1 (Taiwan)' },
    { value: 'asia-east2', label: 'asia-east2 (Hong Kong)' },
    { value: 'asia-northeast1', label: 'asia-northeast1 (Tokyo)' },
    { value: 'asia-northeast3', label: 'asia-northeast3 (Seoul)' },
    { value: 'asia-south1', label: 'asia-south1 (Mumbai)' },
    { value: 'asia-southeast1', label: 'asia-southeast1 (Singapore) 🇸🇬' },
    { value: 'asia-southeast2', label: 'asia-southeast2 (Jakarta)' },
    { value: 'australia-southeast1', label: 'australia-southeast1 (Sydney)' },
  ];

  // Preset base URLs for well-known OpenAI-compatible gateways
  const OPENAI_COMPATIBLE_PRESETS = [
    { value: 'https://api.airender.vn/v1', label: 'AI Render (api.airender.vn)' },
    { value: 'https://api.openai.com/v1', label: 'OpenAI (api.openai.com)' },
    { value: 'https://openrouter.ai/api/v1', label: 'OpenRouter' },
    { value: 'https://api.groq.com/openai/v1', label: 'Groq' },
    { value: 'https://api.deepseek.com/v1', label: 'DeepSeek' },
    { value: 'https://api.x.ai/v1', label: 'xAI (Grok)' },
    { value: 'https://api.mistral.ai/v1', label: 'Mistral' },
    { value: 'https://api.together.xyz/v1', label: 'Together AI' },
    { value: 'http://localhost:11434/v1', label: 'Ollama (local)' },
    { value: 'http://localhost:1234/v1', label: 'LM Studio (local)' },
  ];

  // Shared "Bước 1 — Xác thực" + "Bước 2 — Chọn model" markup used by every provider
  const STEPS_HTML = `
        <!-- STEP 1: Authenticate -->
        <div style="border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-md);margin-top:var(--space-md)">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:var(--space-sm);text-transform:uppercase;letter-spacing:.05em">Bước 1 — Xác thực & Tải danh sách model</div>
          <div class="flex items-center gap-sm" style="flex-wrap:wrap">
            <button class="btn btn-primary" id="btn-authenticate">🔌 Xác thực</button>
            <span id="auth-result" class="text-sm"></span>
          </div>
        </div>

        <!-- STEP 2: Select Model (hidden until authenticated) -->
        <div id="step-model" style="border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-md);margin-top:var(--space-sm);display:none">
          <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:var(--space-sm);text-transform:uppercase;letter-spacing:.05em">Bước 2 — Chọn model</div>
          <div class="input-group" style="margin-bottom:var(--space-sm)">
            <select class="input" id="setting-model" onchange="SettingsUI.onModelChange(this)"></select>
            <div id="setting-model-pricing" class="text-sm mt-sm text-accent" style="display:none; font-weight: 500;"></div>
            <input class="input mt-sm" type="text" id="setting-model-custom"
              placeholder="Nhập model ID tùy chỉnh..." style="display:none;margin-top:6px">
          </div>
          <div class="flex items-center gap-sm" style="flex-wrap:wrap">
            <button class="btn btn-primary" id="btn-test-save">✅ Kiểm tra & Lưu cài đặt</button>
            <span id="test-result" class="text-sm"></span>
          </div>
        </div>
  `;

  let currentSettings = {};
  let isAuthenticated = false;

  async function loadAndRender() {
    currentSettings = await window.api.settings.load();

    // Set active provider in the select element
    const providerSelect = document.getElementById('setting-ai-provider');
    if (providerSelect) {
      providerSelect.value = currentSettings.aiProvider || 'vertex-ai';
    }

    renderApiKeySection();
    loadFormValues();

    // Auto validate existing Service Account JSON on load if present and vertex-ai is active
    if (currentSettings.aiProvider === 'vertex-ai' || !currentSettings.aiProvider) {
      const saText = currentSettings.vertexAI?.serviceAccountJson;
      if (saText) {
        parseVertexJson(saText);
      }
    }
  }

  async function init() {
    await loadAndRender();
    bindEvents();
  }

  function renderApiKeySection() {
    const container = document.getElementById('apikey-content');
    if (!container) return;

    // Get current provider from select or currentSettings
    const providerSelect = document.getElementById('setting-ai-provider');
    const provider = providerSelect ? providerSelect.value : (currentSettings.aiProvider || 'vertex-ai');

    if (provider === 'vertex-ai') {
      const currentRegion = currentSettings.vertexAI?.region || 'global';
      // SECURITY: Do NOT inject dynamic values (serviceAccountJson, projectId) into innerHTML.
      // Values are assigned via DOM API after render to prevent XSS.
      container.innerHTML = `
        <div class="input-group">
          <label class="input-label">Service Account JSON</label>
          <div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
            <textarea class="input" id="setting-vertex-sa" rows="6"
              placeholder='{"type":"service_account","project_id":"...","client_email":"...","private_key":"..."}'
              oninput="SettingsUI.parseVertexJson(this.value)"
              style="font-family:var(--font-mono);font-size:11px; width:100%; resize:vertical;"></textarea>
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; width: 100%;">
              <button class="btn btn-secondary btn-sm" style="flex-shrink: 0;" onclick="SettingsUI.uploadVertexJson()">📁 Tải file JSON (Upload)</button>
              <span id="vertex-sa-status" style="font-size: 11px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;"></span>
            </div>
          </div>
          <span class="text-xs text-muted mt-sm">Paste JSON trực tiếp — Project ID sẽ tự động điền</span>
        </div>
        <div class="grid-2 mt-md" style="gap:var(--space-md)">
          <div class="input-group">
            <label class="input-label">Project ID <span class="badge badge-blue" style="font-size:9px">Auto</span></label>
            <input class="input" id="setting-vertex-project" type="text"
              placeholder="my-gcp-project">
          </div>
          <div class="input-group">
            <label class="input-label">Region</label>
            <select class="input" id="setting-vertex-region">
              ${VERTEX_REGIONS.map(r =>
        `<option value="${r.value}"${r.value === currentRegion ? ' selected' : ''}>${r.label}</option>`
      ).join('')}
            </select>
          </div>
        </div>

${STEPS_HTML}
      `;

      // SECURITY: Assign sensitive values via DOM API (not innerHTML) to prevent XSS
      const saInput = document.getElementById('setting-vertex-sa');
      if (saInput) saInput.value = currentSettings.vertexAI?.serviceAccountJson || '';
      const projInput = document.getElementById('setting-vertex-project');
      if (projInput) projInput.value = currentSettings.vertexAI?.projectId || '';

      const saText = currentSettings.vertexAI?.serviceAccountJson;
      if (saText) {
        parseVertexJson(saText);
      }
    } else if (provider === 'gemini-api') {
      // SECURITY: Do NOT inject apiKey into innerHTML. Value assigned via DOM API after render.
      container.innerHTML = `
        <div class="input-group">
          <label class="input-label">Gemini API Key (Google AI Studio)</label>
          <input class="input" id="setting-gemini-key" type="password"
            placeholder="AIzaSy..."
            style="font-family:var(--font-mono); font-size:13px; width:100%;">
        </div>

        <!-- Warning block for Free Tier Rate limits and Privacy -->
        <div class="card warning-card" style="margin-top: 16px; background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.2); padding: 12px; border-radius: var(--radius-md);">
          <div style="display: flex; gap: 8px; align-items: start;">
            <svg style="width: 20px; height: 20px; color: #f59e0b; flex-shrink: 0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <div style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.5;">
              <strong style="color: #f59e0b;">Lưu ý về Bản Free (AI Studio):</strong><br>
              • <strong>Bảo mật dữ liệu:</strong> Google có thể sử dụng dữ liệu/nội dung dịch của bạn để huấn luyện mô hình. Hãy tránh dịch tài liệu nhạy cảm.<br>
              • <strong>Rate Limit (RPM):</strong> Các model Free bị giới hạn lượt gọi mỗi phút (Ví dụ: 5 RPM cho Gemini 3.5 Flash, 15 RPM cho Gemini 3.1 Flash Lite).<br>
              • <strong>Khuyến nghị:</strong> Bạn <strong>bắt buộc phải chỉnh "Delay giữa các request" lên 5s hoặc 12s</strong> ở phần Xử lý để tránh lỗi quá tải 429.<br>
              • <strong>Mẹo dịch nhiều trang hơn:</strong> Hạn mức req/ngày được tính riêng cho từng model (Ví dụ: 20 req/ngày cho 3.5 Flash, 500 req/ngày cho 3.1 Flash Lite). Nếu hết hạn mức của một model (báo lỗi Quota), bạn có thể đổi sang model Free khác trong danh sách để tiếp tục dịch.
            </div>
          </div>
        </div>

${STEPS_HTML}
      `;

      // SECURITY: Assign API key via DOM API (not innerHTML) to prevent XSS
      const keyInput = document.getElementById('setting-gemini-key');
      if (keyInput) keyInput.value = currentSettings.geminiAPI?.apiKey || '';
    } else if (provider === 'openai-compatible') {
      const cfg = currentSettings.openaiCompatible || {};

      // SECURITY: Do NOT inject baseUrl/apiKey/model into innerHTML — assigned via DOM API below.
      container.innerHTML = `
        <div class="input-group">
          <label class="input-label">Base URL (endpoint OpenAI Compatible)</label>
          <input class="input" id="setting-oai-baseurl" type="text"
            placeholder="https://api.airender.vn/v1"
            style="font-family:var(--font-mono); font-size:13px; width:100%;">
          <span class="text-xs text-muted mt-sm">Nhập phần gốc, thường kết thúc bằng <code>/v1</code> — app tự nối <code>/chat/completions</code>. Dán nhầm cả đuôi cũng được, app sẽ tự cắt.</span>
          <div class="flex items-center gap-sm mt-sm" style="flex-wrap:wrap">
            <span class="text-xs text-muted">Chọn nhanh:</span>
            <select class="input" id="setting-oai-preset" style="max-width:260px;font-size:12px">
              <option value="">— Preset —</option>
              ${OPENAI_COMPATIBLE_PRESETS.map(p => `<option value="${p.value}">${p.label}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="input-group mt-md">
          <label class="input-label">API Key</label>
          <input class="input" id="setting-oai-key" type="password"
            placeholder="sk-..."
            style="font-family:var(--font-mono); font-size:13px; width:100%;">
          <span class="text-xs text-muted mt-sm">Gửi qua header <code>Authorization: Bearer</code>. Để trống nếu dùng server local (Ollama / LM Studio) không yêu cầu key.</span>
        </div>

        <div class="grid-2 mt-md" style="gap:var(--space-md)">
          <div class="input-group">
            <label class="input-label">Giá Input (USD / 1M tokens)</label>
            <input class="input" id="setting-oai-price-in" type="number" min="0" step="0.01" placeholder="0">
          </div>
          <div class="input-group">
            <label class="input-label">Giá Output (USD / 1M tokens)</label>
            <input class="input" id="setting-oai-price-out" type="number" min="0" step="0.01" placeholder="0">
          </div>
        </div>
        <span class="text-xs text-muted">Chỉ dùng để ước tính chi phí trong trang Thống kê. Để 0 nếu không cần.</span>

        <!-- Compatibility note -->
        <div class="card warning-card" style="margin-top: 16px; background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.2); padding: 12px; border-radius: var(--radius-md);">
          <div style="display: flex; gap: 8px; align-items: start;">
            <svg style="width: 20px; height: 20px; color: #f59e0b; flex-shrink: 0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <div style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.5;">
              <strong style="color: #f59e0b;">Lưu ý khi dùng endpoint tùy chỉnh:</strong><br>
              • Endpoint phải hỗ trợ <strong>streaming</strong> (<code>"stream": true</code>) theo chuẩn SSE của OpenAI.<br>
              • Để <strong>dịch file PDF</strong>, model phải nhận được ảnh (vision) — app gửi mỗi trang dưới dạng ảnh, tự thu nhỏ còn tối đa 2000px và nén JPEG để tránh vượt giới hạn dung lượng của endpoint.<br>
              • Nút <strong>Xác thực</strong> đọc danh sách model qua <code>GET /models</code>. Server không hỗ trợ endpoint này thì chọn <strong>"✍️ Tự nhập Model ID"</strong>.<br>
              • Dữ liệu dịch sẽ được gửi tới nhà cung cấp bạn cấu hình — cân nhắc với tài liệu nhạy cảm.
            </div>
          </div>
        </div>
${STEPS_HTML}
      `;

      // SECURITY: Assign values via DOM API (not innerHTML) to prevent XSS
      const urlInput = document.getElementById('setting-oai-baseurl');
      if (urlInput) urlInput.value = cfg.baseUrl || 'https://api.airender.vn/v1';
      const oaiKeyInput = document.getElementById('setting-oai-key');
      if (oaiKeyInput) oaiKeyInput.value = cfg.apiKey || '';
      const priceIn = document.getElementById('setting-oai-price-in');
      if (priceIn) priceIn.value = cfg.pricingInput || 0;
      const priceOut = document.getElementById('setting-oai-price-out');
      if (priceOut) priceOut.value = cfg.pricingOutput || 0;

      // Preset dropdown fills the Base URL field
      document.getElementById('setting-oai-preset')?.addEventListener('change', (e) => {
        if (!e.target.value) return;
        const target = document.getElementById('setting-oai-baseurl');
        if (target) target.value = e.target.value;
        e.target.value = '';
      });
    }

    // Bind step buttons
    document.getElementById('btn-authenticate')?.addEventListener('click', authenticate);
    document.getElementById('btn-test-save')?.addEventListener('click', testAndSave);

    if (isAuthenticated) {
      const stepModel = document.getElementById('step-model');
      if (stepModel) stepModel.style.display = '';
    }
  }

  // --- Model dropdown ---

  function populateModelDropdown(models) {
    const sel = document.getElementById('setting-model');
    if (!sel) return;

    // SECURITY: model IDs/names may come from a user-configured OpenAI-compatible endpoint
    // (GET /models) and are untrusted — escape before interpolating into innerHTML.
    const esc = UIManager.escapeHtml;
    sel.innerHTML =
      models.map(m =>
        `<option value="${esc(m.id)}" data-pricing="${esc(JSON.stringify(m.pricing || null))}" data-limits="${esc(JSON.stringify(m.limits || null))}">${esc(m.name)}</option>`
      ).join('') +
      `<option value="__custom__">✍️ Tự nhập Model ID...</option>`;

    // Auto-select saved model
    const provider = document.getElementById('setting-ai-provider')?.value || 'vertex-ai';
    let savedModel;
    if (provider === 'vertex-ai') {
      savedModel = currentSettings.vertexAI?.model || 'gemini-3.1-flash-lite';
    } else if (provider === 'openai-compatible') {
      savedModel = currentSettings.openaiCompatible?.model || '';
    } else {
      savedModel = currentSettings.geminiAPI?.model || 'gemini-3.5-flash';
    }

    // Reset deleted Gemini models to new default models (not applicable to custom endpoints)
    const deletedModels = ['gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemma-4-26b-a4b-it'];
    if (provider !== 'openai-compatible' && deletedModels.includes(savedModel)) {
      savedModel = provider === 'vertex-ai' ? 'gemini-3.1-flash-lite' : 'gemini-3.5-flash';
    }

    const customInput = document.getElementById('setting-model-custom');

    if (savedModel && models.find(m => m.id === savedModel)) {
      sel.value = savedModel;
      if (customInput) customInput.style.display = 'none';
    } else if (savedModel) {
      sel.value = '__custom__';
      if (customInput) { customInput.value = savedModel; customInput.style.display = ''; }
    } else if (models.length > 0) {
      sel.value = models[0].id;
      if (customInput) customInput.style.display = 'none';
    }

    // Trigger change to update pricing UI
    onModelChange(sel);
  }

  function onModelChange(sel) {
    const customInput = document.getElementById('setting-model-custom');
    if (customInput) customInput.style.display = sel.value === '__custom__' ? '' : 'none';

    const pricingEl = document.getElementById('setting-model-pricing');
    if (!pricingEl) return;

    if (sel.value === '__custom__') {
      pricingEl.style.display = 'none';
      return;
    }

    const provider = document.getElementById('setting-ai-provider')?.value || 'vertex-ai';
    const opt = sel.options[sel.selectedIndex];
    const pricingStr = opt?.getAttribute('data-pricing');
    const limitsStr = opt?.getAttribute('data-limits');

    if (provider === 'openai-compatible') {
      // Custom endpoints have no published price list — show whatever the user entered.
      const pIn = parseFloat(document.getElementById('setting-oai-price-in')?.value) || 0;
      const pOut = parseFloat(document.getElementById('setting-oai-price-out')?.value) || 0;
      pricingEl.innerHTML = (pIn || pOut)
        ? `Bảng giá (tự nhập): Đầu vào <strong>$${pIn}</strong>/1M tokens &#183; Đầu ra <strong>$${pOut}</strong>/1M tokens`
        : `Endpoint tùy chỉnh — chưa nhập đơn giá, chi phí sẽ hiển thị <strong>$0</strong> trong Thống kê.`;
      pricingEl.style.display = 'block';
      return;
    }

    if (provider === 'gemini-api') {
      let rpm = 5;
      let rpd = 20;

      if (limitsStr && limitsStr !== 'null') {
        try {
          const lim = JSON.parse(limitsStr);
          if (lim.rpm) rpm = lim.rpm;
          if (lim.rpd) rpd = lim.rpd;
        } catch { }
      } else {
        // Fallback guess limits for custom typed models (e.g. Pro is usually 2 RPM / 50 RPD in free tier)
        const modelId = sel.value === '__custom__' ? (document.getElementById('setting-model-custom')?.value || '') : sel.value;
        if (modelId.toLowerCase().includes('pro')) {
          rpm = 2;
          rpd = 50;
        }
      }

      const pagesPerMin = Math.floor(rpm / 2);
      const pagesPerDay = Math.floor(rpd / 2);

      pricingEl.innerHTML = `Bảng giá: <strong>Miễn phí ($0.0)</strong> &#183; Hạn mức: <strong>${rpm} req/phút</strong> (~${pagesPerMin} trang/phút) &#183; <strong>${rpd.toLocaleString()} req/ngày</strong> (~${pagesPerDay} trang/ngày)`;
      pricingEl.style.display = 'block';
    } else if (pricingStr && pricingStr !== 'null') {
      try {
        const p = JSON.parse(pricingStr);
        pricingEl.innerHTML = `Bảng giá: Đầu vào <strong>$${p.input}</strong>/1M tokens &#183; Đầu ra <strong>$${p.output}</strong>/1M tokens`;
        pricingEl.style.display = 'block';
      } catch { pricingEl.style.display = 'none'; }
    } else {
      pricingEl.style.display = 'none';
    }
  }

  // --- Parse & Upload SA JSON ---

  function parseVertexJson(jsonText) {
    const ta = document.getElementById('setting-vertex-sa');
    const statusEl = document.getElementById('vertex-sa-status');
    if (!jsonText?.trim()) {
      if (ta) ta.style.borderColor = '';
      if (statusEl) { statusEl.innerHTML = ''; statusEl.style.color = ''; }
      return;
    }
    try {
      const sa = JSON.parse(jsonText);

      // Auto-fill project ID
      if (sa.project_id) {
        const el = document.getElementById('setting-vertex-project');
        if (el) el.value = sa.project_id;
      }

      // Validate required fields
      const required = ['type', 'project_id', 'client_email', 'private_key'];
      const missing = required.filter(k => !sa[k]);

      if (missing.length > 0) {
        if (ta) {
          ta.style.borderColor = 'var(--danger)';
          ta.title = `⚠️ Thiếu: ${missing.join(', ')}`;
        }
        if (statusEl) {
          statusEl.innerHTML = `⚠️ Thiếu trường: ${missing.join(', ')}`;
          statusEl.style.color = 'var(--danger)';
        }
      } else if (sa.type !== 'service_account') {
        if (ta) {
          ta.style.borderColor = 'var(--danger)';
          ta.title = '⚠️ type phải là "service_account"';
        }
        if (statusEl) {
          statusEl.innerHTML = '⚠️ type phải là "service_account"';
          statusEl.style.color = 'var(--danger)';
        }
      } else {
        // Valid
        if (ta) {
          ta.style.borderColor = 'var(--success)';
          ta.title = `✅ Service Account: ${sa.client_email}`;
        }
        if (statusEl) {
          statusEl.innerHTML = `✅ JSON hợp lệ (GCP Project: ${sa.project_id})`;
          statusEl.style.color = 'var(--success)';
        }
      }
    } catch {
      // JSON not complete or invalid
      if (ta && jsonText.trim().length > 5) {
        ta.style.borderColor = 'var(--danger)';
        ta.title = '⚠️ JSON không hợp lệ';
      }
      if (statusEl && jsonText.trim().length > 5) {
        statusEl.innerHTML = '⚠️ JSON không hợp lệ';
        statusEl.style.color = 'var(--danger)';
      }
    }
  }

  async function uploadVertexJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const text = await file.text();
      const ta = document.getElementById('setting-vertex-sa');
      if (ta) { ta.value = text; parseVertexJson(text); }
    };
    input.click();
  }

  // --- Form values ---

  function loadFormValues() {
    const s = currentSettings;
    const q = id => document.getElementById(id);
    if (q('setting-dpi')) q('setting-dpi').value = s.dpi || 300;
    if (q('setting-concurrent')) q('setting-concurrent').value = s.concurrentPages || 2;
    if (q('setting-request-delay')) q('setting-request-delay').value = s.requestDelaySec ?? 2;
    if (q('setting-font')) q('setting-font').value = s.outputFont || 'Times New Roman';
    if (q('setting-pagesize')) q('setting-pagesize').value = s.pageSize || 'A4';
    if (q('setting-fontsize')) q('setting-fontsize').value = s.outputFontSize || 12;
    const mode = s.translateMode || (s.bilingual !== false ? 'bilingual' : 'clean');
    if (q('setting-translate-mode')) q('setting-translate-mode').value = mode;
  }

  function bindEvents() {
    document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
    document.getElementById('setting-ai-provider')?.addEventListener('change', () => {
      isAuthenticated = false; // Reset authentication state when toggling providers
      renderApiKeySection();
    });
  }

  // --- Save settings ---

  async function saveSettings() {
    const q = id => document.getElementById(id);
    const s = { ...currentSettings };
    const provider = q('setting-ai-provider')?.value || 'vertex-ai';
    s.aiProvider = provider;

    // The model dropdown only exists after "Xác thực" populated it. When the user saves
    // other settings before authenticating, fall back to the model already stored for this
    // provider — otherwise we would wipe a working configuration with an empty string.
    const providerConfigKey = provider === 'vertex-ai'
      ? 'vertexAI'
      : (provider === 'openai-compatible' ? 'openaiCompatible' : 'geminiAPI');
    const storedModel = currentSettings[providerConfigKey]?.model || currentSettings.model || '';

    let modelValue = q('setting-model')?.value;
    if (modelValue === '__custom__') modelValue = q('setting-model-custom')?.value;
    modelValue = (modelValue || '').trim() || storedModel;
    s.model = modelValue || s.model;

    s.dpi = parseInt(q('setting-dpi')?.value) || 300;
    s.concurrentPages = parseInt(q('setting-concurrent')?.value) || 2;
    s.requestDelaySec = parseFloat(q('setting-request-delay')?.value) || 0;
    s.sourceLanguage = 'auto';
    s.translateLanguage = s.translateLanguage || 'Tiếng Việt';
    s.translateMode = q('setting-translate-mode')?.value || 'bilingual';
    s.bilingual = s.translateMode === 'bilingual'; // backward compat
    s.outputFont = q('setting-font')?.value || 'Times New Roman';
    s.pageSize = q('setting-pagesize')?.value || 'A4';
    s.outputFontSize = parseInt(q('setting-fontsize')?.value) || 12;

    // Preserve prompt template state
    s.customPrompt = currentSettings.customPrompt || '';
    s.activePromptTemplate = currentSettings.activePromptTemplate || 'default';

    if (provider === 'vertex-ai') {
      s.vertexAI = {
        projectId: q('setting-vertex-project')?.value?.trim() || '',
        region: q('setting-vertex-region')?.value || 'global',
        model: modelValue || '',
        serviceAccountJson: q('setting-vertex-sa')?.value?.trim() || '',
      };
    } else if (provider === 'openai-compatible') {
      s.openaiCompatible = {
        ...currentSettings.openaiCompatible,
        baseUrl: q('setting-oai-baseurl')?.value?.trim() || '',
        apiKey: q('setting-oai-key')?.value?.trim() || '',
        model: modelValue || '',
        pricingInput: parseFloat(q('setting-oai-price-in')?.value) || 0,
        pricingOutput: parseFloat(q('setting-oai-price-out')?.value) || 0,
      };
    } else {
      s.geminiAPI = {
        apiKey: q('setting-gemini-key')?.value?.trim() || '',
        model: modelValue || '',
      };
    }

    await window.api.settings.save(s);
    currentSettings = s;

    // Update provider badge
    window.App?.updateProviderBadge?.();

    UIManager.toast('Đã lưu cài đặt!', 'success');
  }

  // --- STEP 1: Authenticate & load models ---

  async function authenticate() {
    const resultEl = document.getElementById('auth-result');
    if (!resultEl) return;
    resultEl.textContent = '⏳ Đang kết nối...';
    resultEl.style.color = 'var(--text-muted)';

    // Save credentials first
    const q = id => document.getElementById(id);
    const provider = q('setting-ai-provider')?.value || 'vertex-ai';

    if (provider === 'vertex-ai') {
      const saved = {
        ...currentSettings,
        aiProvider: 'vertex-ai',
        vertexAI: {
          projectId: q('setting-vertex-project')?.value?.trim() || '',
          region: q('setting-vertex-region')?.value || 'global',
          model: currentSettings.vertexAI?.model || 'gemini-3.1-flash-lite',
          serviceAccountJson: q('setting-vertex-sa')?.value?.trim() || '',
        },
      };
      await window.api.settings.save(saved);
      currentSettings = saved;
    } else if (provider === 'openai-compatible') {
      const saved = {
        ...currentSettings,
        aiProvider: 'openai-compatible',
        openaiCompatible: {
          ...currentSettings.openaiCompatible,
          baseUrl: q('setting-oai-baseurl')?.value?.trim() || '',
          apiKey: q('setting-oai-key')?.value?.trim() || '',
          model: currentSettings.openaiCompatible?.model || '',
          pricingInput: parseFloat(q('setting-oai-price-in')?.value) || 0,
          pricingOutput: parseFloat(q('setting-oai-price-out')?.value) || 0,
        },
      };
      await window.api.settings.save(saved);
      currentSettings = saved;
    } else {
      const saved = {
        ...currentSettings,
        aiProvider: 'gemini-api',
        geminiAPI: {
          apiKey: q('setting-gemini-key')?.value?.trim() || '',
          model: currentSettings.geminiAPI?.model || 'gemini-3.5-flash',
        },
      };
      await window.api.settings.save(saved);
      currentSettings = saved;
    }

    try {
      const res = await window.api.ai.listModels({
        provider: provider,
      });

      if (res.success) {
        isAuthenticated = true;
        resultEl.textContent = `✅ Kết nối thành công, đã lấy danh sách model!`;
        resultEl.style.color = 'var(--success)';

        const models = res.models || [];
        if (models.length > 0) {
          populateModelDropdown(models);
          UIManager.toast(`Xác thực thành công! ${models.length} model khả dụng.`, 'success');
        } else {
          populateModelDropdown([]);
          UIManager.toast('Xác thực OK nhưng không lấy được danh sách model. Hãy tự nhập Model ID.', 'warning');
        }

        const stepModel = document.getElementById('step-model');
        if (stepModel) stepModel.style.display = '';
      } else {
        isAuthenticated = false;
        resultEl.textContent = `❌ ${res.message}`;
        resultEl.style.color = 'var(--danger)';

        const stepModel = document.getElementById('step-model');
        if (provider === 'openai-compatible') {
          // Many self-hosted / gateway endpoints do not expose GET /models.
          // Keep step 2 usable so the user can type the Model ID by hand.
          resultEl.textContent = `⚠️ Không lấy được danh sách model (${res.message}). Hãy tự nhập Model ID bên dưới.`;
          resultEl.style.color = 'var(--warning)';
          populateModelDropdown([]);
          if (stepModel) stepModel.style.display = '';
        } else if (stepModel) {
          stepModel.style.display = 'none';
        }
      }
    } catch (e) {
      isAuthenticated = false;
      resultEl.textContent = `❌ ${e.message}`;
      resultEl.style.color = 'var(--danger)';
    }
  }

  // --- STEP 2: Test selected model & save ---

  async function testAndSave() {
    const resultEl = document.getElementById('test-result');
    if (!resultEl) return;
    resultEl.textContent = '⏳ Đang kiểm tra model...';
    resultEl.style.color = 'var(--text-muted)';

    let modelValue = document.getElementById('setting-model')?.value || '';
    if (modelValue === '__custom__') {
      modelValue = document.getElementById('setting-model-custom')?.value || '';
    }

    if (!modelValue) {
      resultEl.textContent = '⚠️ Chưa chọn model';
      resultEl.style.color = 'var(--warning)';
      return;
    }

    const provider = document.getElementById('setting-ai-provider')?.value || 'vertex-ai';

    // Save model choice temporarily
    if (provider === 'vertex-ai') {
      currentSettings.vertexAI = { ...currentSettings.vertexAI, model: modelValue };
    } else if (provider === 'openai-compatible') {
      currentSettings.openaiCompatible = { ...currentSettings.openaiCompatible, model: modelValue };
    } else {
      currentSettings.geminiAPI = { ...currentSettings.geminiAPI, model: modelValue };
    }
    currentSettings.model = modelValue;
    await window.api.settings.save(currentSettings);

    try {
      const res = await window.api.ai.testConnection({ provider: provider, model: modelValue });
      if (res.success) {
        resultEl.textContent = `✅ Model "${modelValue}" hoạt động tốt!`;
        resultEl.style.color = 'var(--success)';
        await saveSettings();
        resultEl.textContent = `✅ Đã lưu! Model: ${modelValue}`;
      } else {
        resultEl.textContent = `❌ ${res.message}`;
        resultEl.style.color = 'var(--danger)';
      }
    } catch (e) {
      resultEl.textContent = `❌ ${e.message}`;
      resultEl.style.color = 'var(--danger)';
    }
  }

  return { init, loadAndRender, parseVertexJson, uploadVertexJson, onModelChange };
})();
