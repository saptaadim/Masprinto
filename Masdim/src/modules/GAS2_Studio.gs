



// ==========================================
// 3. FUNGSI WILAYAH & ONGKIR (LOKAL)
// ==========================================

/**
 * Helper: Ekstraksi & Normalisasi Alamat (Request GAS 2 & 4)
 * Memastikan alamat memiliki format Kec. dan Kab. agar terbaca Super Admin.
 */
function normalizeAddress(payload) {
  let addr = (payload.alamat || "").toString();
  
  // 1. Bersihkan Tags [...] (Request Point 3)
  let cleanAddr = addr.replace(/\[.*?\]/g, "").trim();
  let addrUpper = cleanAddr.toUpperCase();
  
  // 2. Jika sudah ada data terpisah dari payload (input form), gunakan itu
  let kec = (payload.kecamatan || "").toString().trim();
  let kab = (payload.kabupaten || "").toString().trim();
  let prov = (payload.provinsi || "").toString().trim();
  
  // 3. Jika data terpisah kosong, coba extract dari string alamat (Request Point 4: Fallback)
  if (!kec || !kab) {
    // Keyword Match (Kecamatan / Kab)
    let mKec = addrUpper.match(/(?:KECAMATAN|KEC\.?)\s+([A-Z0-9\s]+?)(?:,|$|\d)/);
    let mKab = addrUpper.match(/(?:KABUPATEN|KAB\.?|KOTA)\s+([A-Z0-9\s]+?)(?:,|$|\d)/);
    
    if (mKec && !kec) kec = mKec[1].trim();
    if (mKab && !kab) kab = mKab[1].trim();
    
    // Database Fallback if still empty (Request Point 4)
    if (!kec) {
      const db = getDatabaseWilayah();
      for (let p in db) {
        for (let k in db[p]) {
          for (let kc of db[p][k]) {
            if (addrUpper.includes(kc.toUpperCase())) {
              kec = kc;
              if (!kab) kab = k;
              if (!prov) prov = p;
              break;
            }
          }
          if (kec) break;
        }
        if (kec) break;
      }
    }
  }
  
  // 4. Konstruksi Alamat Terstandarisasi (Agar Super Admin Mudah Membaca)
  // Pastikan ada kata kunci "Kec." dan "Kab." (Request Tips 2)
  let hasKec = addrUpper.includes("KECAMATAN") || addrUpper.includes("KEC.");
  let hasKab = addrUpper.includes("KABUPATEN") || addrUpper.includes("KAB.") || addrUpper.includes("KOTA");
  
  let suffix = "";
  if (kec && !hasKec) suffix += ", Kec. " + kec;
  if (kab && !hasKab) suffix += ", Kab. " + kab;
  else if (kec && !hasKab) suffix += ", Kab. NASIONAL"; // Point 4: Fallback Nasional
  
  if (prov && !addrUpper.includes(prov.toUpperCase())) suffix += ", " + prov;
  
  cleanAddr += suffix;
  
  return {
    normalizedAlamat: cleanAddr,
    kecamatan: kec || "-",
    kabupaten: kab || (kec ? "NASIONAL" : "-"),
    provinsi: prov || "-"
  };
}

function getDatabaseWilayah() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Database_Wilayah");
    if (!sheet) throw new Error("Sheet 'Database_Wilayah' tidak ditemukan!");
    
    const data = sheet.getDataRange().getValues();
    let hasil = {}; // { "Provinsi": { "Kabupaten": ["Kecamatan", ...] } }
    
    for (let i = 1; i < data.length; i++) {
      let prov = data[i][0] ? data[i][0].toString().trim() : "";
      let kab = data[i][1] ? data[i][1].toString().trim() : "";
      let kec = data[i][2] ? data[i][2].toString().trim() : "";
      
      if (prov && kab && kec) {
        if (!hasil[prov]) hasil[prov] = {};
        if (!hasil[prov][kab]) hasil[prov][kab] = [];
        if (hasil[prov][kab].indexOf(kec) === -1) hasil[prov][kab].push(kec);
      }
    }
    
    // Sort keys alphabetically
    const sortedHasil = {};
    Object.keys(hasil).sort().forEach(p => {
      sortedHasil[p] = {};
      Object.keys(hasil[p]).sort().forEach(k => {
        sortedHasil[p][k] = hasil[p][k].sort();
      });
    });
    
    return sortedHasil;
  } catch (e) { throw new Error("Gagal membaca Database Wilayah: " + e.message); }
}

function getOngkir(provinsi, kabupaten, kecamatan, totalQty) {
  if (!totalQty || totalQty < 1) totalQty = 1;
  const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
  const sheetOngkir = ss.getSheetByName("Ongkir");
  if (!sheetOngkir) return 0; 
  
  const dataOngkir = sheetOngkir.getDataRange().getValues();
  let tarifPertama = 0; let tarifSelanjutnya = 0;
  
  // Asumsi Kolom Ongkir: A=Provinsi, B=Kabupaten, C=Kecamatan, D=Tarif1, E=TarifNext
  for (let i = 1; i < dataOngkir.length; i++) {
    let rowProv = dataOngkir[i][0] ? dataOngkir[i][0].toString().trim().toLowerCase() : "";
    let rowKab = dataOngkir[i][1] ? dataOngkir[i][1].toString().trim().toLowerCase() : "";
    let rowKec = dataOngkir[i][2] ? dataOngkir[i][2].toString().trim().toLowerCase() : "";
    
    if (rowProv === provinsi.trim().toLowerCase() && 
        rowKab === kabupaten.trim().toLowerCase() && 
        rowKec === kecamatan.trim().toLowerCase()) {
      
      tarifPertama = Number(dataOngkir[i][3]) || 0; 
      let valE = dataOngkir[i][4];
      tarifSelanjutnya = (valE !== "" && valE !== undefined) ? Number(valE) : tarifPertama; 
      break;
    }
  }
  
  if (tarifPertama === 0) return 0; 
  let beratKg = Math.ceil(totalQty * 0.25);
  if (beratKg < 1) beratKg = 1;
  return (beratKg === 1) ? tarifPertama : tarifPertama + (tarifSelanjutnya * (beratKg - 1));
}

// ==========================================
// 4. FUNGSI PROSES PESANAN & UPLOAD
// ==========================================
// ==========================================
// 4. FUNGSI PROSES PESANAN & UPLOAD
// ==========================================
function processOrderForm(payload) {
  // ATOMIC LOCK: Mencegah Parallel Race Condition (Serangan Hacker Point 3)
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(10000); // Tunggu maksimal 10 detik untuk antrian request

    if (isSystemOffline()) {
      return { status: "Error", message: "Sistem sedang dalam perbaikan. Coba lagi nanti." };
    }

    // 1. SECURITY: Validasi Token Sesi (Handshake)
    if (!payload || !payload.sessionToken) {
      return { status: "Error", message: "Akses ditolak. Sesi tidak valid." };
    }
    const isValidSession = validateTempToken(payload.sessionToken, "ORDER_SESSION") || validateTempToken(payload.sessionToken, "SHOP_SESSION");
    if (!isValidSession) {
      return { status: "Error", message: "Sesi telah kadaluwarsa. Silakan refresh halaman." };
    }

    // 2. SECURITY: Hardened Rate Limiting (Anti-Spam 2 menit)
    const userProp = PropertiesService.getUserProperties();
    const lastOrder = userProp.getProperty("last_order_timestamp");
    const nowTime = new Date().getTime();
    if (lastOrder && (nowTime - lastOrder < 120000)) {
      return { status: "Error", message: "Tunggu 2 menit sebelum memesan lagi." };
    }

    // 3. SECURITY: Anti Email-Bombing (Maks 1 email tiap 5 menit per alamat)
    const scriptProp = PropertiesService.getScriptProperties();
    const emailKey = "email_limit_" + (payload.email || "guest").replace(/[^a-zA-Z0-9]/g, "");
    const lastEmailSent = Number(scriptProp.getProperty(emailKey) || 0);
    if (nowTime - lastEmailSent < 300000) {
      return { status: "Error", message: "Email ini terlalu sering digunakan. Tunggu sebentar." };
    }

    // 4. SECURITY: Sanitasi & Batasan Panjang (Cegah Bloating)
    const cleanNama = (payload.nama || "Tanpa Nama").replace(/[<>:"\/\\|?*]/g, "").substring(0, 50).trim();
    const cleanWA = (payload.wa || "").replace(/[^0-9]/g, "").substring(0, 15);
    if (cleanWA.length < 10) return { status: "Error", message: "Nomor WhatsApp tidak valid." };

    // 5. SECURITY: Validasi Ukuran File (Max 8MB total)
    const MAX_UPLOAD_SIZE = 8 * 1024 * 1024;
    let totalSize = 0;
    if (payload.desainFiles) payload.desainFiles.forEach(f => totalSize += (f.base64 || "").length);
    if (payload.mockupFiles) payload.mockupFiles.forEach(f => totalSize += (f.base64 || "").length);
    if (payload.buktiBase64) totalSize += payload.buktiBase64.length;
    
    if (totalSize > (MAX_UPLOAD_SIZE * 1.33)) {
      return { status: "Error", message: "File terlalu besar (Maks 8MB). Silakan kompres gambar Anda." };
    }

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Order");
    const folder = DriveApp.getFolderById(CONFIG.UPLOAD_FOLDER_ID); 
    const dbPrice = getPricingData();
    
    // 6. INVOICE ID YANG LEBIH KUAT
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const invDate = new Date();
    const invoiceId = "MSP-" + invDate.getTime().toString().slice(-4) + "-" + randomSuffix;

    const uploadFile = (base64, mime, prefixName) => {
      if (!base64) return "";
      // Gunakan nama file acak untuk keamanan extra
      const randomFileId = Math.random().toString(36).substring(2, 8).toUpperCase();
      let blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, `${prefixName}_${randomFileId}.png`);
      return folder.createFile(blob).getUrl();
    };

    let links = { desain: "", mockup: "", bukti: "" };
    let desainLinksArray = [];
    if (payload.desainFiles && payload.desainFiles.length > 0) {
      for (let i = 0; i < payload.desainFiles.length; i++) {
        desainLinksArray.push(uploadFile(payload.desainFiles[i].base64, payload.desainFiles[i].mime, "DSN"));
      }
    }
    links.desain = desainLinksArray.join(" , "); 

    let mockupLinksArray = [];
    if (payload.mockupFiles && payload.mockupFiles.length > 0) {
      for (let i = 0; i < payload.mockupFiles.length; i++) {
        mockupLinksArray.push(uploadFile(payload.mockupFiles[i].base64, payload.mockupFiles[i].mime, "MKP"));
      }
    }
    links.mockup = mockupLinksArray.join(" , "); 
    links.bukti = uploadFile(payload.buktiBase64, payload.buktiMimeType, "PAY");

    let resiMarketplaceUrl = "";
    if (payload.resiMarketplaceFile) {
      resiMarketplaceUrl = uploadFile(payload.resiMarketplaceFile.base64, payload.resiMarketplaceFile.mime, "RESI");
    }

    // 7. STRICT PRICING RE-CALCULATION (Sisi Server)
    let totalQty = payload.cart.reduce((sum, item) => sum + item.qty, 0);
    let uniqueColors = new Set(payload.cart.map(item => (item.warna === "Lainnya (PO)" ? item.warnaPO : item.warna || "").trim().toLowerCase()));
    uniqueColors.delete(""); 
    let uniqueKain = new Set(payload.cart.map(item => item.kain));
    let isGrosir = (totalQty >= 12 && uniqueColors.size <= 2 && uniqueKain.size === 1);
    let totalOrder = 0;
    
    const cartDetails = payload.cart.map(item => {
      let kodeKaos = `Kaos_${item.kain}_${item.size}_${item.lengan}`.toUpperCase();
      let hargaKaos = dbPrice.kaos[kodeKaos] || 0;
      let hargaSablonDict = isGrosir ? dbPrice.sablonGrosir : dbPrice.sablonSatuan;
      let hargaSablonTotal = 0;
      
      if (item.sablonAreas && item.sablonAreas.length > 0) {
        item.sablonAreas.forEach(area => { 
          let areaUpper = area.toString().toUpperCase();
          hargaSablonTotal += hargaSablonDict[areaUpper] || 0; 
        });
      }
      
      let subtotal = (hargaKaos + hargaSablonTotal) * item.qty;
      totalOrder += subtotal;
      let displayWarna = item.warna === "Lainnya (PO)" ? `PO: ${item.warnaPO}` : item.warna;
      return `${item.qty}x ${item.kain} (${item.size}) - ${displayWarna} | Rp${subtotal.toLocaleString('id-ID')}`;
    }).join("\n");

    // 8. MANDATORY SERVER-SIDE ONGKIR
    let ongkirFinal = (payload.shippingMode === "marketplace") ? 0 : getOngkir(payload.provinsi, payload.kabupaten, payload.kecamatan, totalQty);
    const grandTotalFinal = totalOrder + ongkirFinal;

    const addrData = normalizeAddress(payload);

    if (!payload.skipSheetWrite) {
      // Menentukan variabel berdasarkan sumber (Retail vs Mitra)
      const channel = payload.channel || "RETAIL_WEB";
      const idMitra = payload.idMitra || "-";
      const namaBrand = payload.namaToko || "-";
      const modalPusat = payload.subtotalMasprinto ? payload.subtotalMasprinto : totalOrder;
      const profitMitra = payload.profitMitraTotal || 0;
      
      const idDesainFinal = (payload.idDesain || payload.refId || payload.kodeSablon || "-");
      const linkFolderFinal = (payload.folderUrl || links.desain || links.mockup || "-");

      // Struktur 29 Kolom Data Prima (Gabungan Retail & Mitra)
      sheet.appendRow([
        invDate,                     // A: Timestamp
        invoiceId,                   // B: Invoice_ID
        channel,                     // C: Channel
        idMitra,                     // D: ID_Mitra
        namaBrand,                   // E: Nama_Brand
        cleanNama,                   // F: Nama_Pelanggan
        "'" + cleanWA,               // G: Nomor_WA
        payload.email || "-",        // H: Email
        cartDetails,                 // I: Rincian_Order
        totalQty,                    // J: Total_Qty
        payload.instruksi || "",     // K: Catatan
        addrData.normalizedAlamat,   // L: Alamat_Lengkap
        payload.kurir || "JNT",      // M: Kurir
        ongkirFinal,                 // N: Ongkir
        modalPusat,                  // O: Modal_Pusat (Hak Masprinto)
        profitMitra,                 // P: Profit_Mitra (Hak Mitra)
        grandTotalFinal,             // Q: Grand_Total
        payload.metodeBayar || "Transfer", // R: Metode_Bayar
        idDesainFinal,                // S: ID_Desain
        linkFolderFinal,              // T: Link_Folder
        links.bukti || resiMarketplaceUrl || "-", // U: Bukti_Bayar
        "Menunggu Validasi",         // V: Status_Order
        "-",                         // W: Nomor_Resi
        addrData.provinsi,           // X: Provinsi
        addrData.kabupaten,          // Y: Kabupaten
        addrData.kecamatan,          // Z: Kecamatan
        payload.kodepos,             // AA: Kode_Pos
        "",                          // AB: SLA_Proses
        ""                           // AC: SLA_Kirim
      ]);
    }

    // Update cooldown
    userProp.setProperty("last_order_timestamp", nowTime.toString());
    scriptProp.setProperty(emailKey, nowTime.toString());

    kirimEmailInvoice(payload, cartDetails, grandTotalFinal, totalOrder, invoiceId, ongkirFinal);
    
    return { status: "Sukses", invoice: invoiceId, links: links };

  } catch (e) {
    return { status: "Error", message: e.toString() };
  } finally {
    lock.releaseLock(); // Selalu lepas lock
  }
}

// ==========================================
// 5. FUNGSI EMAIL INVOICE
// ==========================================
function kirimEmailInvoice(data, cartDetails, grandTotal, totalOrder, invoiceId, ongkirFinal) {
  try {
    const trackLink = ScriptApp.getService().getUrl() + "?page=tracker&track=" + invoiceId;
    const subject = "Invoice Pesanan Masprinto [" + invoiceId + "]";
    let htmlBody = `<div style="font-family: Arial; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2>Terima Kasih, ${data.nama}!</h2>
      <p>Pesanan <b>${invoiceId}</b> sedang diproses.</p>
      <div style="background: #f9f9f9; padding: 15px; margin: 20px 0;">
        ${cartDetails.replace(/\n/g, '<br>')}
      </div>
      <p><b>Total: Rp ${grandTotal.toLocaleString('id-ID')}</b></p>
      <a href="${trackLink}" style="background: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Lacak Pesanan</a>
    </div>`;
    
    MailApp.sendEmail({ to: data.email, subject: subject, htmlBody: htmlBody });
  } catch (e) {}
}

// ==========================================
// AMBIL LINK FOLDER DESAIN BERDASARKAN ID & PIN
// ==========================================
function getDesignFolderUrl(shortId, accessPin) {
  try {
    // SECURITY: Validasi PIN wajib (Serangan Hacker Point 1)
    if (!accessPin) return { status: "error", message: "Akses Ditolak! PIN diperlukan." };

    const ss = SpreadsheetApp.openById(CONFIG.STUDIO_SS_ID);
    const sheet = ss.getSheetByName(CONFIG.STUDIO_SHEET_NAME);
    const dataRow = sheet.getDataRange().getValues();
    
    const id = shortId.toString().trim().toUpperCase();
    const pin = accessPin.toString().trim();

    for(let i=1; i<dataRow.length; i++){
      // Cek ID di Kolom A (Index 0) dan PIN di Kolom F (Index 5)
      if(dataRow[i][0] === id) {
        if (dataRow[i][5].toString() === pin) {
          return { status: "success", url: dataRow[i][1] };
        } else {
          return { status: "error", message: "PIN Salah! Akses ditolak." };
        }
      }
    }
    return { status: "error", message: "ID Desain tidak ditemukan." };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

/**
 * Fallback sesi order agar frontend bisa refresh token tanpa reload penuh.
 */
function getOrderSessionToken() {
  return generateTempToken("ORDER_SESSION", "GUEST");
}