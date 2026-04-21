// Updated: 2026-04-17 23:55
// ==========================================
// ROUTER PUSAT (MONOLITH WEB APP)
// ==========================================

function doGet(e) {
  try {
    let p = (e && e.parameter) ? e.parameter : {};
    let page = p.page || 'studio';
    
    // CEK STATUS MAINTENANCE (Sinkron dengan Super Admin)
    if (isSystemOffline()) {
      return HtmlService.createTemplateFromFile('ui/Maintenance')
          .evaluate()
          .setTitle('Maintenance Mode - Masprinto')
          .addMetaTag('viewport', 'width=device-width, initial-scale=1')
          .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    
    const BASE_URL = ScriptApp.getService().getUrl();
    
    let template;
    let title = 'Masprinto';
    
    // Fungsi helper untuk inisialisasi template dengan data dasar
    const initTemplate = (file) => {
      let t = HtmlService.createTemplateFromFile(file);
      t.baseUrl = BASE_URL;
      t.idOrder = p.id || p.idOrder || "";
      t.idMitra = p.mid || p.sid || p.id_mitra || "";
      t.token = p.token || "";
      t.trackId = p.track || "";
      t.accessPin = p.pin || "";
      t.mode = "";
      return t;
    };

    switch(page) {
      case 'order':
        template = initTemplate('ui/GAS2_Index');
        // SECURITY: Generate temporary session token for public order
        template.sessionToken = generateTempToken("ORDER_SESSION", "GUEST");
        title = 'Form Order Masprinto';
        break;
      case 'mitra':
        template = initTemplate('ui/GAS3_Index');
        // SECURITY: Generate temporary session token for mitra registration
        template.sessionToken = generateTempToken("MITRA_SESSION", "GUEST");
        // Forward mode parameter (register = skip landing page)
        template.mode = p.mode || "";
        title = 'Pendaftaran Mitra Masprinto';
        break;
      case 'tracker':
        template = initTemplate('ui/GAS4_Index');
        template.appMode = 'track';
        // SECURITY: Token pelacakan
        template.sessionToken = generateTempToken("TRACKING_SESSION", "GUEST");
        title = 'Tracking Pesanan';
        break;
      case 'shop':
      case 'order_mitra':
        template = initTemplate('ui/GAS4_Index');
        template.appMode = 'order';
        // SECURITY: Token order mitra
        template.sessionToken = generateTempToken("SHOP_SESSION", "GUEST");
        title = 'Order Form';
        break;
      case 'dashboard':
        template = initTemplate('ui/GAS5_Index');
        // SECURITY: Token sesi dashboard untuk proteksi aksi (update/upload)
        template.sessionToken = generateTempToken("DASHBOARD_SESSION", "GUEST");
        title = 'Dashboard Mitra';
        break;

      case 'studio':
      default:
        template = initTemplate('ui/GAS1_Index');
        // SECURITY: Generate temporary session token for public user
        template.sessionToken = generateTempToken("STUDIO_SESSION", "GUEST");
        title = 'Masprinto Studio';
        break;
    }

    return template.evaluate()
        .setTitle(title)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  } catch (err) {
    return HtmlService.createHtmlOutput("<h3>System Error</h3><p>" + err.toString() + "</p>");
  }
}

// Fungsi wajib agar <?!= include('nama_file'); ?> di HTML dapat berjalan
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
