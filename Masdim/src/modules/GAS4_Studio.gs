// ==========================================
// GAS 4: TRACKER & MITRA ORDER FORM
// ==========================================

/**
 * FUNGSI TRACKING PESANAN (GAS 2 & GAS 4)
 */
function trackOrder(invoiceId, waSuffix, sessionToken) {
  try {
    if (isSystemOffline()) {
      return { status: "Error", message: "Sistem sedang dalam perbaikan. Coba lagi nanti." };
    }

    // 1. SECURITY: Validasi Token Sesi (Handshake)
    if (!sessionToken) return { status: "Error", message: "Akses ditolak." };
    const isValidSession = validateTempToken(sessionToken, "TRACKING_SESSION");
    if (!isValidSession) return { status: "Error", message: "Sesi kadaluwarsa." };

    // 2. SECURITY: Hardened Anti Brute-force (Maks 5 attempt, lockout 30 menit)
    const userProp = PropertiesService.getUserProperties();
    let trackAttempts = Number(userProp.getProperty("track_attempts") || 0);
    const lastAttempt = Number(userProp.getProperty("last_track_attempt") || 0);
    const now = new Date().getTime();

    if (trackAttempts >= 5 && (now - lastAttempt < 1800000)) {
      const waitTime = Math.ceil((1800000 - (now - lastAttempt)) / 60000);
      return { status: "Error", message: `Keamanan: Terlalu banyak mencoba. Blokir sementara ${waitTime} menit.` };
    }

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    let id = invoiceId.toString().trim().toUpperCase();

    const searchInSheet = (sheetName) => {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) return null;
      const data = sheet.getDataRange().getValues();
      const colInv = 1; // Kolom B
      const colWA = (sheetName === "Order_mitra") ? 5 : 6; 
      
      for (let i = 1; i < data.length; i++) {
        if (data[i][colInv].toString().trim().toUpperCase() === id) {
          
          // 3. SECURITY: Validasi Identitas (4 Digit Terakhir WA)
          let fullWA = data[i][colWA].toString().replace(/\D/g, '');
          let last4 = fullWA.substring(fullWA.length - 4);
          
          if (last4 !== waSuffix) {
            userProp.setProperty("track_attempts", (trackAttempts + 1).toString());
            userProp.setProperty("last_track_attempt", now.toString());
            return { status: "Error", message: "Verifikasi gagal! Data tidak cocok." };
          }

          // Reset attempts jika sukses
          userProp.setProperty("track_attempts", "0");

          // Ambil status dari sheet utama
          let statusProd = "Antrian";
          let resiProd = "-";
          const sheetOrder = ss.getSheetByName("Order");
          if (sheetOrder) {
            const dataO = sheetOrder.getDataRange().getValues();
            for (let j = 1; j < dataO.length; j++) {
              if (dataO[j][1].toString().trim().toUpperCase() === id) {
                statusProd = dataO[j][21] || "Antrian"; // Kolom V
                resiProd = dataO[j][22] || "-"; // Kolom W
                break;
              }
            }
          }

          return {
            status: "Sukses",
            invoice: id,
            nama: data[i][sheetName === "Order_mitra" ? 4 : 5],
            progress: statusProd,
            resi: resiProd,
            rincian: data[i][8] || "",
            alamat: (data[i][sheetName === "Order_mitra" ? 6 : 11] || "").toString().replace(/\[.*?\]/g, "").trim(),
            total: data[i][sheetName === "Order_mitra" ? 12 : 16] || 0,
            update: Utilities.formatDate(data[i][0], "GMT+7", "dd MMM yyyy HH:mm")
          };
        }
      }
      return null;
    };

    let result = searchInSheet("Order_mitra");
    if (!result) result = searchInSheet("Order");
    
    if (result) return result;
    return { status: "Not Found", message: "Invoice tidak ditemukan." };

  } catch (e) { return { status: "Error", message: e.toString() }; }
}

/**
 * KIRIM LINK PELACAKAN KE EMAIL (Rate Limited)
 */
function sendTrackingLink(invoiceId) {
  try {
    if (isSystemOffline()) {
      return { status: "Error", message: "Sistem sedang dalam perbaikan. Coba lagi nanti." };
    }

    const scriptProp = PropertiesService.getScriptProperties();
    const lastSent = Number(scriptProp.getProperty("last_track_email_" + invoiceId) || 0);
    const now = new Date().getTime();
    
    // Limit 10 menit per invoice
    if (now - lastSent < 600000) return { status: "Error", message: "Link baru saja dikirim. Cek inbox/spam Anda." };

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Order");
    const data = sheet.getDataRange().getValues();
    const inv = invoiceId.toString().trim().toUpperCase();

    let orderData = null;
    for (let i = 1; i < data.length; i++) {
      if (data[i][1].toString().trim().toUpperCase() === inv) {
        orderData = { nama: data[i][5], email: data[i][7] };
        break;
      }
    }

    if (!orderData || !orderData.email) return { status: "Error", message: "Data tidak ditemukan." };

    const trackLink = ScriptApp.getService().getUrl() + "?page=tracker&track=" + inv;
    const subject = "Pelacakan Pesanan Masprinto - " + inv;
    const htmlBody = `<div style="font-family:Arial; padding:20px; border:1px solid #ddd; border-radius:10px;">
      <h2>Halo ${orderData.nama}!</h2>
      <p>Klik tombol di bawah untuk melacak pesanan Anda:</p>
      <a href="${trackLink}" style="background:#4f46e5; color:white; padding:10px 20px; text-decoration:none; border-radius:5px; display:inline-block;">Lacak Pesanan</a>
    </div>`;

    MailApp.sendEmail({ to: orderData.email, subject: subject, htmlBody: htmlBody });
    scriptProp.setProperty("last_track_email_" + invoiceId, now.toString());
    
    return { status: "Sukses", message: "Link telah dikirim." };
  } catch (e) { return { status: "Error", message: e.toString() }; }
}



/**
 * AMBIL HARGA TER-MARKUP (Source of Truth)
 */
function getMitraPricing(idMitra, idOrderAsli) {
  try {
    const pricing = getPricingData(); 
    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const id = idMitra.toString().trim().toUpperCase();
    const desainId = (idOrderAsli || "").toString().trim().toUpperCase();
    
    let profit = 0;
    let sheetProduk = ss.getSheetByName("Produk_Mitra");
    if (sheetProduk) {
      const dataProduk = sheetProduk.getDataRange().getValues();
      for (let i = dataProduk.length - 1; i >= 1; i--) {
        const rowId = (dataProduk[i][1] || "").toString().trim().toUpperCase();
        const rowDesain = (dataProduk[i][2] || "").toString().trim().toUpperCase();
        if (rowId === id && (!desainId || rowDesain === desainId)) {
          profit = Number(dataProduk[i][6]) || 0; // Kolom G: Profit
          break;
        }
      }
    }

    // Fallback legacy jika Produk_Mitra belum terisi
    if (!profit) {
      const sheet = ss.getSheetByName("Data_Mitra");
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][1].toString().trim().toUpperCase() === id) {
          profit = Number(data[i][9]) || 0;
          break;
        }
      }
    }
    
    // Merge profit ke harga kaos di server
    Object.keys(pricing.kaos).forEach(key => { pricing.kaos[key] += profit; });
    
    return { kaos: pricing.kaos, sablonSatuan: pricing.sablonSatuan, profitPerPcs: profit };
  } catch (e) { return null; }
}

/**
 * PROSES ORDER DARI FORM MITRA (Strict Security)
 */
function processMitraOrder(payload) {
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(15000);

    if (isSystemOffline()) {
      return { status: "Error", message: "Sistem sedang dalam perbaikan. Coba lagi nanti." };
    }

    // 1. SECURITY: Validasi Token Sesi (Handshake)
    if (!payload || !payload.sessionToken) return { status: "Error", message: "Akses ditolak." };
    const isValidSession = validateTempToken(payload.sessionToken, "SHOP_SESSION");
    if (!isValidSession) return { status: "Error", message: "Sesi kadaluwarsa." };

    // 2. SECURITY: Rate Limiting
    const userProp = PropertiesService.getUserProperties();
    const lastOrder = userProp.getProperty("last_mitra_order_timestamp");
    const nowTime = new Date().getTime();
    if (lastOrder && (nowTime - lastOrder < 120000)) return { status: "Error", message: "Tunggu 2 menit." };

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const dbPrice = getPricingData();
    
    // 3. SECURITY: RE-CALCULATE (Source of Truth dari Produk_Mitra)
    // Abaikan sablonText dari klien, gunakan data produk resmi milik mitra.
    const sheetMitraData = ss.getSheetByName("Data_Mitra");
    const mitraRows = sheetMitraData.getDataRange().getValues();
    const sheetProduk = ss.getSheetByName("Produk_Mitra");
    let profitPerPcs = 0;
    let officialKodeSablon = "";
    let foundMitra = false;
    let foundProduk = false;
    
    for (let i = 1; i < mitraRows.length; i++) {
      if (mitraRows[i][1].toString().toUpperCase() === payload.idMitra.toUpperCase()) {
        foundMitra = true;
        break;
      }
    }
    if (!foundMitra) return { status: "Error", message: "Mitra tidak ditemukan." };

    if (sheetProduk) {
      const dataProduk = sheetProduk.getDataRange().getValues();
      const idDesainReq = (payload.idOrderAsli || "").toString().trim().toUpperCase();
      for (let i = dataProduk.length - 1; i >= 1; i--) {
        const rowMitra = (dataProduk[i][1] || "").toString().trim().toUpperCase();
        const rowDesain = (dataProduk[i][2] || "").toString().trim().toUpperCase();
        if (rowMitra === payload.idMitra.toString().trim().toUpperCase() && (!idDesainReq || rowDesain === idDesainReq)) {
          officialKodeSablon = (dataProduk[i][3] || "").toString().toUpperCase(); // Kolom D
          profitPerPcs = Number(dataProduk[i][6]) || 0; // Kolom G
          foundProduk = true;
          break;
        }
      }
    }

    // Fallback legacy jika produk belum termigrasi
    if (!foundProduk) {
      for (let i = 1; i < mitraRows.length; i++) {
        if (mitraRows[i][1].toString().toUpperCase() === payload.idMitra.toUpperCase()) {
          profitPerPcs = Number(mitraRows[i][9]) || 0;
          officialKodeSablon = (mitraRows[i][6] || "").toString().toUpperCase();
          break;
        }
      }
    }

    let totalQty = payload.cart.reduce((sum, item) => sum + item.qty, 0);
    let subtotalPusat = 0;
    let profitTotal = 0;

    payload.cart.forEach(item => {
      let modalKaos = dbPrice.kaos[`Kaos_${item.kain}_${item.size}_${item.lengan}`.toUpperCase()] || 0;
      
      // Hitung Biaya Sablon berdasarkan Source of Truth
      let modalSablon = 0;
      let areas = officialKodeSablon.match(/A3|A4|LOGO|NECKLABEL|LENGAN/g) || [];
      areas.forEach(area => { modalSablon += (dbPrice.sablonSatuan[area] || 0); });
      
      subtotalPusat += (modalKaos + modalSablon) * item.qty;
      profitTotal += (profitPerPcs * item.qty);
      
      // Inject kode sablon asli agar data di Spreadsheet Order Utama benar
      item.sablonText = officialKodeSablon;
    });

    // RE-CALCULATE ONGKIR
    const ongkir = getOngkir(payload.provinsi, payload.kabupaten, payload.kecamatan, totalQty);
    
    // Override payload untuk keamanan sebelum panggil GAS 2
    payload.ongkir = ongkir;
    payload.subtotalMasprinto = subtotalPusat;
    payload.profitMitraTotal = profitTotal;
    payload.channel = "MITRA_DROPSHIP"; // Identifikasi untuk Data Prima

    // 4. Panggil Fungsi Order Utama (Otomatis menulis ke sheet Order Master)
    const result = processOrderForm(payload);
    
    if (result.status === "Sukses") {
      userProp.setProperty("last_mitra_order_timestamp", nowTime.toString());
    }
    
    return result;
  } catch (e) { return { status: "Error", message: e.toString() }; }
  finally { lock.releaseLock(); }
}

/**
 * Validasi akses link order mitra berdasarkan status produk.
 */
function validateMitraProductAccess(idMitra, idOrder, token) {
  try {
    let targetMitra = (idMitra || "").toString().trim().toUpperCase();
    if (!targetMitra && token) {
      const mitraByToken = validateMitraAuth(token) || getMitraDataByToken(token);
      targetMitra = (mitraByToken && mitraByToken.idMitra) ? mitraByToken.idMitra.toString().trim().toUpperCase() : "";
    }
    const targetDesain = (idOrder || "").toString().trim().toUpperCase();
    if (!targetMitra || !targetDesain) {
      return { status: "Error", message: "Link produk tidak lengkap." };
    }

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Produk_Mitra");
    if (!sheet) return { status: "Error", message: "Produk tidak tersedia." };
    const data = sheet.getDataRange().getValues();

    for (let i = data.length - 1; i >= 1; i--) {
      const rowMitra = (data[i][1] || "").toString().trim().toUpperCase();
      const rowDesain = (data[i][2] || "").toString().trim().toUpperCase();
      if (rowMitra === targetMitra && rowDesain === targetDesain) {
        const rowStatus = (data[i][8] || "Active").toString().trim().toUpperCase();
        if (rowStatus !== "ACTIVE") {
          return { status: "Expired", message: "Link produk ini sudah dinonaktifkan atau kedaluwarsa." };
        }
        return { status: "Sukses" };
      }
    }
    return { status: "Expired", message: "Produk tidak ditemukan atau sudah dinonaktifkan." };
  } catch (e) {
    return { status: "Error", message: e.toString() };
  }
}
