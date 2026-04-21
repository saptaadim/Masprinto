
// ==========================================
// REGISTRASI MITRA KE MASTER SPREADSHEET
// ==========================================
function registerMitraBaru(payload) {
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(15000); // Tunggu 15 detik untuk antrian pendaftaran

    if (isSystemOffline()) {
      return { status: "Error", message: "Sistem sedang dalam perbaikan. Coba lagi nanti." };
    }

    // 1. SECURITY: Validasi Token Sesi (Handshake)
    if (!payload || !payload.sessionToken) {
      return { status: "Error", message: "Akses ditolak. Sesi tidak valid." };
    }
    const isValidSession = validateTempToken(payload.sessionToken, "MITRA_SESSION");
    if (!isValidSession) {
      return { status: "Error", message: "Sesi pendaftaran kadaluwarsa. Silakan refresh." };
    }

    // 2. SECURITY: Identitas & Kepemilikan Order (Cegah Hacker Point 2)
    const ssStudio = SpreadsheetApp.openById(CONFIG.STUDIO_SS_ID);
    const sheetStudio = ssStudio.getSheetByName(CONFIG.STUDIO_SHEET_NAME);
    const dataStudio = sheetStudio.getDataRange().getValues();
    const targetId = payload.idOrderAsli.toString().trim().toUpperCase();
    const targetPin = (payload.accessPin || "").toString().trim();
    let isOrderValid = false;

    // Cari ID Order (PIN opsional jika datang dari link pendaftaran email)
    for (let i = 1; i < dataStudio.length; i++) {
      const rowId = (dataStudio[i][0] || "").toString().trim().toUpperCase();
      if (rowId === targetId) {
        // Jika ada PIN, harus cocok. Jika tidak ada PIN (dari email), anggap valid selama ID ada.
        const rowPin = (dataStudio[i][5] || "").toString().trim();
        if (!targetPin || rowPin === targetPin) {
           isOrderValid = true;
           break;
        }
      }
    }
    if (!isOrderValid) {
      return { status: "Error", message: "Verifikasi Gagal: ID Desain tidak ditemukan atau PIN tidak cocok. Gunakan link resmi dari Studio." };
    }

    // 2b. SECURITY: Kunci ownership desain di Database_Desain (anti-ambil desain milik mitra lain)
    const ssMaster = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheetDesain = ssMaster.getSheetByName("Database_Desain");
    const dataDesain = sheetDesain.getDataRange().getValues();
    let desainRowIndex = -1;
    let desainOwnerId = "";
    const reqIdOrder = (payload.idOrderAsli || "").toString().trim().toUpperCase();
    
    for (let j = 1; j < dataDesain.length; j++) {
      if ((dataDesain[j][0] || "").toString().trim().toUpperCase() === reqIdOrder) {
        desainRowIndex = j + 1;
        desainOwnerId = (dataDesain[j][6] || "").toString().trim().toUpperCase(); // Kolom G: ID Mitra
        break;
      }
    }
    if (desainRowIndex === -1) {
      return { status: "Error", message: "ID desain tidak ditemukan di Database_Desain." };
    }

    // 3. SECURITY: Rate Limiting (Anti-Spam 10 menit per user)
    const userProp = PropertiesService.getUserProperties();
    const lastReg = userProp.getProperty("last_mitra_registration");
    const nowTime = new Date().getTime();
    if (lastReg && (nowTime - lastReg < 600000)) {
      return { status: "Error", message: "Terlalu sering mendaftar. Tunggu sebentar." };
    }

    // 4. SECURITY: Batas Profit (Cegah Sabotase Ekonomi Hacker Point 3)
    const profitNominal = Number(payload.profit) || 0;
    if (profitNominal < 0 || profitNominal > 500000) {
      return { status: "Error", message: "Profit tidak masuk akal (Maks Rp 500.000 per kaos)." };
    }

    // 5. VALIDASI EMAIL DUPLIKAT (Hanya jika belum login)
    const sheet = ssMaster.getSheetByName("Data_Mitra");
    const dataMitra = sheet.getDataRange().getValues();
    const emailTarget = (payload.email || "").toLowerCase().trim();
    
    let foundIdMitra = "";
    if (payload.isLoggedIn) {
       const m = getMitraDataByEmail(emailTarget);
       if (!m) return { status: "Error", message: "Sesi login tidak valid atau email tidak cocok." };
       foundIdMitra = m.idMitra;
    } else {
      for (let i = 1; i < dataMitra.length; i++) {
        // Kolom E (Index 4) = Email Owner
        if (dataMitra[i][4] && dataMitra[i][4].toString().toLowerCase().trim() === emailTarget) {
          return { status: "Error", message: "Email ini sudah terdaftar sebagai Mitra. Silakan login." };
        }
      }

      // Jika belum login (mitra baru), desain wajib belum punya owner
      if (desainOwnerId) {
        return { status: "Error", message: "Desain ini sudah terhubung ke mitra lain. Gunakan desain baru dari Studio." };
      }
    }

    // Jika login sebagai mitra lama, desain hanya boleh kosong atau milik dirinya sendiri
    if (payload.isLoggedIn && desainOwnerId && desainOwnerId !== foundIdMitra.toString().trim().toUpperCase()) {
      return { status: "Error", message: "Desain ini sudah diklaim mitra lain dan tidak bisa dipakai ulang." };
    }

    // 7. Identity Generation & Tokens
    const timeStamp = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
    let idMitra = "";
    let accessToken = "";
    let linkToko = "";

    if (!payload.isLoggedIn) {
      const randomHex = Math.random().toString(36).substring(2, 6).toUpperCase();
      idMitra = "MTR-" + Utilities.getUuid().substring(0, 4).toUpperCase() + "-" + randomHex;
      accessToken = generateTempToken("MITRA", idMitra);
      linkToko = getUrl("shop") + "&mid=" + idMitra;
    } else {
      idMitra = foundIdMitra;
      // Gunakan token yang sudah ada atau generate baru
      accessToken = generateTempToken("MITRA", idMitra); 
    }

    // 6. Sanitasi Input
    const cleanNama = (payload.nama || "").replace(/[<>:"\/\\|?*]/g, "").substring(0, 50).trim();
    const cleanAlamat = (payload.alamat || "").replace(/[<>]/g, "").substring(0, 255).trim();
    const cleanAtasNama = (payload.atasNama || "").replace(/[<>:"\/\\|?*]/g, "").substring(0, 50).trim();
    
    // FASE 3: HUBUNGKUN DESAIN KE MITRA (Database_Desain)
    sheetDesain.getRange(desainRowIndex, 5).setValue("Active"); // Status: Active
    sheetDesain.getRange(desainRowIndex, 7).setValue(payload.isLoggedIn ? foundIdMitra : idMitra); // ID Mitra

    if (!payload.isLoggedIn) {
      // SIMPAN MITRA BARU (Data_Mitra fokus profil mitra)
      // Kolom F-J sengaja dikosongkan agar produk tersimpan di sheet Produk_Mitra
      sheet.appendRow([
        timeStamp,             // A: Timestamp
        idMitra,               // B: ID Mitra
        cleanNama,             // C: Nama Brand
        "'" + payload.wa,      // D: WA Owner
        payload.email,         // E: Email Owner
        "",                    // F: (legacy) ID Desain Master
        "",                    // G: (legacy) Kode Area
        "",                    // H: (legacy) Kain Default
        "",                    // I: (legacy) Warna Default
        "",                    // J: (legacy) Profit
        payload.bank,          // K: Nama Bank
        "'" + payload.rekening,// L: No Rekening
        cleanAtasNama,         // M: Atas Nama
        cleanAlamat,           // N: Alamat Toko
        accessToken,           // O: Access Token
        linkToko               // P: Link Shop URL
      ]);
    }

    // Produk mitra disimpan terpisah per desain/produk
    upsertProdukMitra({
      idMitra: payload.isLoggedIn ? foundIdMitra : idMitra,
      idOrderAsli: payload.idOrderAsli,
      kodeSablon: payload.kodeSablon,
      kain: payload.kain,
      warnaFix: payload.warnaFix,
      profit: profitNominal,
      folderId: payload.folderId
    });

    userProp.setProperty("last_mitra_registration", nowTime.toString());

    return {
      status: "Sukses",
      idMitra: payload.isLoggedIn ? foundIdMitra : idMitra,
      nama: payload.isLoggedIn ? "Mitra Terdaftar" : cleanNama,
      idOrder: payload.idOrderAsli,
      token: accessToken,
      linkToko: payload.isLoggedIn ? (getUrl("shop") + "&mid=" + foundIdMitra) : linkToko
    };

  } catch (error) {
    return { status: "Error", message: "Gagal menyimpan data: " + error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * UPSERT PRODUK MITRA
 * Menyimpan konfigurasi produk per desain agar Data_Mitra fokus profil.
 */
function upsertProdukMitra(product) {
  const ssMaster = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
  let sheetProduk = ssMaster.getSheetByName("Produk_Mitra");
  if (!sheetProduk) {
    sheetProduk = ssMaster.insertSheet("Produk_Mitra");
    sheetProduk.appendRow([
      "Timestamp",
      "ID_Mitra",
      "ID_Desain",
      "Kode_Sablon",
      "Kain_Default",
      "Warna_Default",
      "Profit_Per_Pcs",
      "Folder_ID",
      "Status"
    ]);
    sheetProduk.getRange("A1:I1").setFontWeight("bold").setBackground("#f1f5f9");
  }

  const dataProduk = sheetProduk.getDataRange().getValues();
  const tid = (product.idMitra || "").toString().trim().toUpperCase();
  const did = (product.idOrderAsli || "").toString().trim().toUpperCase();
  const nowStr = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");

  for (let i = dataProduk.length - 1; i >= 1; i--) {
    const rowTid = (dataProduk[i][1] || "").toString().trim().toUpperCase();
    const rowDid = (dataProduk[i][2] || "").toString().trim().toUpperCase();
    if (rowTid === tid && rowDid === did) {
      sheetProduk.getRange(i + 1, 1, 1, 9).setValues([[
        nowStr,
        tid,
        did,
        product.kodeSablon || "",
        product.kain || "30s",
        product.warnaFix || "Hitam",
        Number(product.profit) || 0,
        product.folderId || "",
        "Active"
      ]]);
      return;
    }
  }

  sheetProduk.appendRow([
    nowStr,
    tid,
    did,
    product.kodeSablon || "",
    product.kain || "30s",
    product.warnaFix || "Hitam",
    Number(product.profit) || 0,
    product.folderId || "",
    "Active"
  ]);
}

/**
 * FASE 2: MAGIC LINK AUTHENTICATION
 * Mengirim link login unik ke email mitra.
 */
function sendMitraLoginLinkAuth(identifier, currentIdOrder, accessPin) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Data_Mitra");
    const data = sheet.getDataRange().getValues();
    const idenUpper = identifier.toString().trim().toUpperCase();
    
    let targetMitra = null;
    
    for (let i = 1; i < data.length; i++) {
      let mId = (data[i][1] || "").toString().trim().toUpperCase();
      let mEmail = (data[i][4] || "").toString().trim().toUpperCase(); // Kolom E (Index 4) Email Owner
      
      if (mId === idenUpper || mEmail === idenUpper) {
        targetMitra = {
          id: data[i][1],
          nama: data[i][2], // Kolom C (Index 2) Nama Brand
          email: data[i][4]  // Kolom E (Index 4) Email Owner
        };
        break;
      }
    }
    
    if (!targetMitra) {
      return { status: "Error", message: "Email atau ID Mitra tidak ditemukan di sistem." };
    }
    
    // Generate Token
    const magicToken = generateTempToken("MITRA", targetMitra.id);
    if (!magicToken) throw new Error("Gagal membuat token akses.");
    
    // Kirim Email
    const dashLink = getUrl("dashboard") + "&token=" + magicToken;
    
    const subject = "Link Login Dashboard Masprinto - " + targetMitra.nama;
    const htmlBody = `<div style="font-family:Arial; padding:20px; border:1px solid #ddd; border-radius:12px;">
      <h2>Halo ${targetMitra.nama},</h2>
      <p>Gunakan link di bawah ini untuk masuk ke Dashboard Masprinto Anda secara otomatis (berlaku 24 jam):</p>
      <div style="margin: 20px 0;">
        <a href="${dashLink}" style="background:#0ea5e9; color:white; padding:15px 30px; border-radius:10px; text-decoration:none; font-weight:bold; font-size:16px;">MASUK DASHBOARD SEKARANG</a>
      </div>
      <p style="color:#64748b; font-size:12px;">Jangan berikan link ini kepada siapapun.<br>- Sistem Masprinto</p>
    </div>`;
                 
    MailApp.sendEmail({
      to: targetMitra.email,
      subject: subject,
      htmlBody: htmlBody
    });
    
    return { status: "Sukses", message: `Magic Link berhasil dikirim ke ${targetMitra.email}. Silakan cek kotak masuk atau folder spam.` };
    
  } catch (e) {
    return { status: "Error", message: e.toString() };
  }
}