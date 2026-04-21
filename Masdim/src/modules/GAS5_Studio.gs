/**
 * AMBIL DATA DASHBOARD MITRA (Optimized & Secure)
 */
function getDashboardData(token, sessionToken) {
  try {
    // Untuk aksi READ-ONLY ini, cukup validasi token mitra.
    // Session token DASHBOARD_SESSION hanya diperlukan untuk aksi write (update/upload).
    // Ini mencegah login loop saat user membuka halaman setelah session token expire.
    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    
    // 1. Validasi Auth (Magic Link atau Static Token)
    const mitra = validateMitraAuth(token);
    if (!mitra) return { status: "Error", message: "Token Akses Tidak Valid. Silakan minta link baru." };
    const targetIdMitra = (mitra.idMitra || "").toString().trim().toUpperCase();
    if (!targetIdMitra) return { status: "Error", message: "Data Mitra tidak valid." };
    
    // 2. Ambil Data Desain (Gallery)
    const sheetDesain = ss.getSheetByName("Database_Desain");
    const dataDesain = sheetDesain.getDataRange().getValues();
    let designs = [];
    
    for (let i = 1; i < dataDesain.length; i++) {
      let idMitraDesain = (dataDesain[i][6] || "").toString().trim().toUpperCase();
      if (idMitraDesain === targetIdMitra) {
        designs.push({
          id: dataDesain[i][0],
          folder: dataDesain[i][1],
          kode: dataDesain[i][2],
          tanggal: dataDesain[i][3],
          status: dataDesain[i][4],
          pin: dataDesain[i][5]
        });
      }
    }
    
    const products = getProdukByMitra(targetIdMitra);
    const sheetOrder = ss.getSheetByName("Order");
    
    // OPTIMASI: Ambil 1000 baris terakhir untuk efisiensi
    const lastRowOrder = sheetOrder.getLastRow();
    let dataOrder = [];
    if (lastRowOrder > 1) {
      const startRowOrder = Math.max(2, lastRowOrder - 1000);
      dataOrder = sheetOrder.getRange(startRowOrder, 1, (lastRowOrder - startRowOrder) + 1, 29).getValues();
    }
    
    let orders = [];
    let stats = { totalOrder: 0, totalProfit: 0, totalHutang: 0, lunasCount: 0, pendingCount: 0, totalProducts: products.length, totalDesigns: designs.length };
    
    dataOrder.forEach(r => {
      let idMitraRow = (r[3] || "").toString().trim().toUpperCase(); // Kolom D (Index 3): ID_Mitra
      let channel = (r[2] || "").toString().trim().toUpperCase(); // Kolom C (Index 2): Channel
      
      if (idMitraRow === targetIdMitra && channel === "MITRA_DROPSHIP") {
        let invId = r[1].toString().trim().toUpperCase(); // Kolom B: Invoice
        let statusProd = r[21] || "Antrian"; // Kolom V: Status Order
        if ((statusProd || "").toString().trim().toUpperCase() === "DIHAPUS MITRA") return;
        let resiProd = r[22] || "-"; // Kolom W: Resi
        
        const buyerProof = r[20] || "-"; // Kolom U: Bukti bayar dari pembeli
        const pusatProof = r[27] || "-"; // Kolom AB: Bukti bayar ke pusat oleh mitra
        let row = {
          tanggal: r[0] instanceof Date ? Utilities.formatDate(r[0], "GMT+7", "dd/MM/yy") : "-",
          invoice: invId, 
          customer: r[5], // Kolom F: Nama Pelanggan
          subtotalMasprinto: Number(r[14]) || 0, // Kolom O: Modal Pusat
          profitMitra: Number(r[15]) || 0, // Kolom P: Profit Mitra
          totalCustomer: Number(r[16]) || 0, // Kolom Q: Grand Total
          statusBayar: statusProd, // Kita gunakan Status Order gabungan
          buktiBayarCust: buyerProof,
          buktiBayarPusat: pusatProof,
          rincian: r[8] || "-", // Kolom I: Rincian Order
          progress: statusProd, 
          resi: resiProd
        };
        orders.push(row);
        stats.totalOrder++;
        stats.totalProfit += row.profitMitra;
        if (statusProd.toString().toUpperCase() === "LUNAS" || statusProd.toString().toUpperCase() === "PROSES CETAK") {
          stats.lunasCount++; 
        } else {
          stats.pendingCount++;
        }
        if (!row.buktiBayarPusat || row.buktiBayarPusat === "-") {
          stats.totalHutang += row.subtotalMasprinto;
        }
      }
    });
    
    return { 
      status: "Sukses", 
      mitra: mitra, 
      orders: orders.reverse(), 
      products: products,
      designs: designs.reverse(),
      stats: stats 
    };
  } catch (e) { return { status: "Error", message: e.toString() }; }
}

/**
 * Helper auth berbasis token untuk frontend SPA.
 */
function getMitraByToken(token) {
  return validateMitraAuth(token);
}

function getMitraById(idMitra) {
  return getMitraDataById(idMitra);
}

/**
 * Mengambil daftar produk milik mitra dari sheet Produk_Mitra.
 */
function getProdukByMitra(idMitra) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Produk_Mitra");
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    const tid = (idMitra || "").toString().trim().toUpperCase();
    let out = [];
    for (let i = 1; i < data.length; i++) {
      if ((data[i][1] || "").toString().trim().toUpperCase() === tid) {
        out.push({
          timestamp: data[i][0],
          idMitra: data[i][1],
          idDesain: data[i][2],
          kodeSablon: data[i][3],
          kainDefault: data[i][4],
          warnaDefault: data[i][5],
          profit: Number(data[i][6]) || 0,
          folderId: data[i][7],
          status: data[i][8] || "Active"
        });
      }
    }
    return out.reverse();
  } catch (e) {
    return [];
  }
}

/**
 * Membuat / update produk dari desain milik mitra langsung dari Dashboard (SPA).
 */
function createProdukFromDesain(token, sessionToken, payload) {
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(10000);
    if (!sessionToken) return { status: "Error", message: "Akses ditolak." };
    const isValidSession = validateTempToken(sessionToken, "DASHBOARD_SESSION");
    if (!isValidSession) return { status: "Error", message: "Sesi kadaluwarsa." };
    const mitra = validateMitraAuth(token);
    if (!mitra) return { status: "Error", message: "Sesi tidak valid." };

    const idDesain = (payload.idDesain || "").toString().trim();
    if (!idDesain) return { status: "Error", message: "ID desain wajib diisi." };

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheetDesain = ss.getSheetByName("Database_Desain");
    const dataDesain = sheetDesain ? sheetDesain.getDataRange().getValues() : [];
    let desain = null;
    for (let i = 1; i < dataDesain.length; i++) {
      if ((dataDesain[i][0] || "").toString().trim() === idDesain) {
        const owner = (dataDesain[i][6] || "").toString().trim().toUpperCase();
        if (owner && owner !== mitra.idMitra.toString().trim().toUpperCase()) {
          return { status: "Error", message: "Desain ini milik mitra lain." };
        }
        desain = dataDesain[i];
        break;
      }
    }
    if (!desain) return { status: "Error", message: "Desain tidak ditemukan." };

    upsertProdukMitra({
      idMitra: mitra.idMitra,
      idOrderAsli: idDesain,
      kodeSablon: payload.kodeSablon || desain[2] || "",
      kain: payload.kain || "30s",
      warnaFix: payload.warnaFix || "Hitam",
      profit: Number(payload.profit) || 0,
      folderId: desain[1] || ""
    });
    return { status: "Sukses", message: "Produk berhasil disimpan." };
  } catch (e) {
    return { status: "Error", message: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Update produk mitra (edit spesifikasi).
 */
function updateProdukMitra(token, sessionToken, payload) {
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(10000);
    if (!sessionToken) return { status: "Error", message: "Akses ditolak." };
    const isValidSession = validateTempToken(sessionToken, "DASHBOARD_SESSION");
    if (!isValidSession) return { status: "Error", message: "Sesi kadaluwarsa." };
    const mitra = validateMitraAuth(token);
    if (!mitra) return { status: "Error", message: "Sesi tidak valid." };

    const idDesain = (payload.idDesain || "").toString().trim().toUpperCase();
    if (!idDesain) return { status: "Error", message: "ID desain wajib diisi." };

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Produk_Mitra");
    if (!sheet) return { status: "Error", message: "Sheet Produk_Mitra tidak ditemukan." };
    const data = sheet.getDataRange().getValues();
    const tid = mitra.idMitra.toString().trim().toUpperCase();

    for (let i = data.length - 1; i >= 1; i--) {
      const rowTid = (data[i][1] || "").toString().trim().toUpperCase();
      const rowDid = (data[i][2] || "").toString().trim().toUpperCase();
      if (rowTid === tid && rowDid === idDesain) {
        sheet.getRange(i + 1, 4).setValue(payload.kodeSablon || ""); // D
        sheet.getRange(i + 1, 5).setValue(payload.kain || "30s"); // E
        sheet.getRange(i + 1, 6).setValue(payload.warnaFix || "Hitam"); // F
        sheet.getRange(i + 1, 7).setValue(Number(payload.profit) || 0); // G
        sheet.getRange(i + 1, 9).setValue(payload.status || "Active"); // I
        sheet.getRange(i + 1, 1).setValue(Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss")); // A
        return { status: "Sukses", message: "Produk berhasil diupdate." };
      }
    }
    return { status: "Error", message: "Produk tidak ditemukan." };
  } catch (e) {
    return { status: "Error", message: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Ubah status produk (mis. Nonaktifkan produk).
 */
function updateProdukMitraStatus(token, sessionToken, idDesain, newStatus) {
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(10000);
    if (!sessionToken) return { status: "Error", message: "Akses ditolak." };
    const isValidSession = validateTempToken(sessionToken, "DASHBOARD_SESSION");
    if (!isValidSession) return { status: "Error", message: "Sesi kadaluwarsa." };
    const mitra = validateMitraAuth(token);
    if (!mitra) return { status: "Error", message: "Sesi tidak valid." };

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Produk_Mitra");
    if (!sheet) return { status: "Error", message: "Sheet Produk_Mitra tidak ditemukan." };
    const data = sheet.getDataRange().getValues();
    const tid = mitra.idMitra.toString().trim().toUpperCase();
    const did = (idDesain || "").toString().trim().toUpperCase();
    const statusVal = (newStatus || "Nonaktif").toString().trim();

    for (let i = data.length - 1; i >= 1; i--) {
      const rowTid = (data[i][1] || "").toString().trim().toUpperCase();
      const rowDid = (data[i][2] || "").toString().trim().toUpperCase();
      if (rowTid === tid && rowDid === did) {
        sheet.getRange(i + 1, 9).setValue(statusVal);
        sheet.getRange(i + 1, 1).setValue(Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss"));
        return { status: "Sukses", message: "Status produk diperbarui." };
      }
    }
    return { status: "Error", message: "Produk tidak ditemukan." };
  } catch (e) {
    return { status: "Error", message: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Update profil mitra dari menu Pengaturan Akun.
 */
function updateMitraSettings(token, sessionToken, payload) {
  try {
    if (!sessionToken) return { status: "Error", message: "Akses ditolak." };
    const isValidSession = validateTempToken(sessionToken, "DASHBOARD_SESSION");
    if (!isValidSession) return { status: "Error", message: "Sesi kadaluwarsa." };
    const mitra = validateMitraAuth(token);
    if (!mitra) return { status: "Error", message: "Sesi tidak valid." };

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Data_Mitra");
    const data = sheet.getDataRange().getValues();
    const tid = mitra.idMitra.toString().trim().toUpperCase();

    const cleanNama = (payload.namaToko || "").toString().replace(/[<>:"\/\\|?*]/g, "").substring(0, 50).trim();
    const cleanWa = (payload.wa || "").toString().replace(/\D/g, "");
    const cleanBank = (payload.bankName || "").toString().substring(0, 40).trim();
    const cleanAcc = (payload.bankAcc || "").toString().replace(/\D/g, "").substring(0, 30);
    const cleanOwner = (payload.bankOwner || "").toString().replace(/[<>:"\/\\|?*]/g, "").substring(0, 50).trim();
    const cleanAlamat = (payload.alamat || "").toString().replace(/[<>]/g, "").substring(0, 255).trim();

    for (let i = 1; i < data.length; i++) {
      if ((data[i][1] || "").toString().trim().toUpperCase() === tid) {
        sheet.getRange(i + 1, 3).setValue(cleanNama || data[i][2]);  // C nama toko
        sheet.getRange(i + 1, 4).setValue("'" + (cleanWa || data[i][3])); // D wa
        sheet.getRange(i + 1, 11).setValue(cleanBank || data[i][10]); // K bank
        sheet.getRange(i + 1, 12).setValue("'" + (cleanAcc || data[i][11])); // L rekening
        sheet.getRange(i + 1, 13).setValue(cleanOwner || data[i][12]); // M atas nama
        sheet.getRange(i + 1, 14).setValue(cleanAlamat || data[i][13]); // N alamat
        return { status: "Sukses", message: "Pengaturan akun berhasil diperbarui." };
      }
    }
    return { status: "Error", message: "Data mitra tidak ditemukan." };
  } catch (e) {
    return { status: "Error", message: e.toString() };
  }
}

/**
 * Hapus desain milik mitra (soft delete).
 */
function deleteMitraDesign(token, sessionToken, designId) {
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(10000);
    if (!sessionToken) return { status: "Error", message: "Akses ditolak." };
    const isValidSession = validateTempToken(sessionToken, "DASHBOARD_SESSION");
    if (!isValidSession) return { status: "Error", message: "Sesi kadaluwarsa." };
    const mitra = validateMitraAuth(token);
    if (!mitra) return { status: "Error", message: "Sesi tidak valid." };

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Database_Desain");
    const data = sheet.getDataRange().getValues();
    const did = (designId || "").toString().trim();
    const tid = mitra.idMitra.toString().trim().toUpperCase();

    for (let i = 1; i < data.length; i++) {
      const rowId = (data[i][0] || "").toString().trim();
      const rowOwner = (data[i][6] || "").toString().trim().toUpperCase();
      if (rowId === did) {
        if (rowOwner !== tid) return { status: "Error", message: "Desain bukan milik Anda." };
        sheet.getRange(i + 1, 5).setValue("Deleted"); // status
        sheet.getRange(i + 1, 7).setValue(""); // lepas owner
        return { status: "Sukses", message: "Desain berhasil dihapus." };
      }
    }
    return { status: "Error", message: "Desain tidak ditemukan." };
  } catch (e) {
    return { status: "Error", message: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Tracking inline di dashboard mitra (tanpa pindah halaman).
 */
function getOrderTrackingMitra(token, sessionToken, invoiceId) {
  try {
    if (!sessionToken) return { status: "Error", message: "Akses ditolak." };
    const isValidSession = validateTempToken(sessionToken, "DASHBOARD_SESSION");
    if (!isValidSession) return { status: "Error", message: "Sesi kadaluwarsa." };
    const mitra = validateMitraAuth(token);
    if (!mitra) return { status: "Error", message: "Sesi tidak valid." };

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Order");
    const data = sheet.getDataRange().getValues();
    const inv = (invoiceId || "").toString().trim().toUpperCase();
    const tid = mitra.idMitra.toString().trim().toUpperCase();

    for (let i = 1; i < data.length; i++) {
      const rowInv = (data[i][1] || "").toString().trim().toUpperCase();
      const rowMitra = (data[i][3] || "").toString().trim().toUpperCase();
      if (rowInv === inv && rowMitra === tid) {
        return {
          status: "Sukses",
          invoice: rowInv,
          progress: data[i][21] || "Antrian",
          resi: data[i][22] || "-",
          alamat: data[i][11] || "-",
          total: Number(data[i][16]) || 0,
          customer: data[i][5] || "-",
          updatedAt: data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], "GMT+7", "dd MMM yyyy HH:mm") : "-"
        };
      }
    }
    return { status: "Error", message: "Invoice tidak ditemukan." };
  } catch (e) {
    return { status: "Error", message: e.toString() };
  }
}

/**
 * UPDATE STATUS (Hanya untuk Catatan Internal Mitra)
 * Status Keuangan "LUNAS" HANYA bisa diubah oleh ADMIN di Spreadsheet Master
 */
function updateOrderStatusMitra(token, sessionToken, invoiceId, status) {
  try {
    if (isSystemOffline()) {
      return { status: "Error", message: "Sistem sedang dalam perbaikan. Coba lagi nanti." };
    }

    if (!sessionToken) return { status: "Error", message: "Akses ditolak." };
    const isValidSession = validateTempToken(sessionToken, "DASHBOARD_SESSION");
    if (!isValidSession) return { status: "Error", message: "Sesi kadaluwarsa." };

    const allowedStatuses = ["Belum Diperiksa", "Belum Lunas", "Lunas", "Pembayaran Ditolak"];
    if (allowedStatuses.indexOf((status || "").toString().trim()) === -1) {
      return { status: "Error", message: "Status pembayaran tidak valid." };
    }

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const mitra = validateMitraAuth(token);
    if (!mitra) return { status: "Error", message: "Sesi tidak valid." };

    const sheet = ss.getSheetByName("Order");
    const data = sheet.getDataRange().getValues();
    const inv = invoiceId.toString().trim().toUpperCase();
    const tid = mitra.idMitra.toString().trim().toUpperCase();

    for (let i = 1; i < data.length; i++) {
      if (data[i][1].toString().trim().toUpperCase() === inv && data[i][3].toString().trim().toUpperCase() === tid) {
        // Hanya update jika status saat ini bukan Lunas (Cegah override admin)
        if (data[i][21].toString().toUpperCase() === "LUNAS") return { status: "Error", message: "Order sudah dikunci oleh Admin." };
        
        sheet.getRange(i + 1, 22).setValue(status); // Kolom 22 (V) status pembayaran/order
        return { status: "Sukses" };
      }
    }
    return { status: "Error", message: "Akses ditolak." };
  } catch (e) { return { status: "Error", message: e.toString() }; }
}

/**
 * UPLOAD BUKTI BAYAR KE PUSAT (Secure Ownership)
 */
function uploadProofPusat(token, sessionToken, invoiceId, base64, mime) {
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(10000);
    if (isSystemOffline()) {
      return { status: "Error", message: "Sistem sedang dalam perbaikan. Coba lagi nanti." };
    }

    if (!sessionToken) return { status: "Error", message: "Akses ditolak." };
    const isValidSession = validateTempToken(sessionToken, "DASHBOARD_SESSION");
    if (!isValidSession) return { status: "Error", message: "Sesi kadaluwarsa." };

    // Validasi Ukuran (Maks 10MB)
    if (base64.length > (10 * 1024 * 1024 * 1.33)) return { status: "Error", message: "File Max 10MB." };

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const mitra = validateMitraAuth(token);
    if (!mitra) return { status: "Error", message: "Sesi tidak valid." };

    const sheet = ss.getSheetByName("Order");
    const data = sheet.getDataRange().getValues();
    const inv = invoiceId.toString().trim().toUpperCase();
    const tid = mitra.idMitra.toString().trim().toUpperCase();

    // 1. SECURITY: Verifikasi Kepemilikan Invoice (Anti-Injection)
    let foundIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][1].toString().trim().toUpperCase() === inv && data[i][3].toString().trim().toUpperCase() === tid) {
        foundIndex = i + 1;
        break;
      }
    }

    if (foundIndex === -1) return { status: "Error", message: "Akses ditolak: Invoice bukan milik Anda." };

    // 2. Proses Upload
    const folder = DriveApp.getFolderById(CONFIG.UPLOAD_FOLDER_ID);
    let blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, "PAY_" + tid + "_" + inv);
    let url = folder.createFile(blob).getUrl();

    sheet.getRange(foundIndex, 28).setValue(url); // Kolom 28 (AB): Bukti Bayar ke Pusat
    sheet.getRange(foundIndex, 22).setValue("Belum Diperiksa"); // Kolom 22 (V) update status pembayaran
    return { status: "Sukses", url: url };

  } catch (e) { return { status: "Error", message: e.toString() }; }
  finally { lock.releaseLock(); }
}

/**
 * KIRIM LINK DASHBOARD (Privacy-Protected)
 */
function sendDashboardLink(emailOrId, draftId) {
  try {
    if (isSystemOffline()) {
      return { status: "Error", message: "Sistem sedang dalam perbaikan. Coba lagi nanti." };
    }

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Data_Mitra");
    const data = sheet.getDataRange().getValues();
    const query = emailOrId.toString().toLowerCase().trim();
    const draft = (draftId || "").toString().trim();
    
    let matchingMitra = [];
    for (let i = 1; i < data.length; i++) {
      // Kolom B (Index 1) = ID Mitra, Kolom E (Index 4) = Email Owner
      if (data[i][1].toString().toLowerCase().trim() === query || data[i][4].toString().toLowerCase().trim() === query) {
        matchingMitra.push({ idMitra: data[i][1], namaToko: data[i][2], email: data[i][4] }); // Kolom C (Index 2) = Nama Brand
      }
    }

    // ======= MITRA BARU (Tidak ditemukan) → Kirim link pendaftaran GAS 3 =======
    if (matchingMitra.length === 0) {
      if (!query.includes("@")) {
        return { status: "Error", message: "ID Mitra tidak ditemukan. Jika Anda belum terdaftar, masukkan email untuk menerima link pendaftaran." };
      }

      // Jika draft sudah diklaim mitra lain, jangan kirim link pendaftaran reuse desain
      if (draft) {
        const sheetDesain = ss.getSheetByName("Database_Desain");
        if (sheetDesain) {
          const dataDesain = sheetDesain.getDataRange().getValues();
          for (let i = 1; i < dataDesain.length; i++) {
            if ((dataDesain[i][0] || "").toString().trim() === draft) {
              const ownerId = (dataDesain[i][6] || "").toString().trim();
              if (ownerId) {
                return { status: "Error", message: "Desain ini sudah terhubung ke mitra lain. Buat desain baru untuk pendaftaran email baru." };
              }
              break;
            }
          }
        }
      }
      
      const baseUrl = ScriptApp.getService().getUrl();
      // Sertakan draft ID di link pendaftaran agar GAS 3 bisa menghubungkan desain
      let registerLink = baseUrl + "?page=mitra&mode=register";
      if (draft) registerLink += "&id=" + draft;
      
      const regHtml = `<div style="font-family:Arial; padding:20px; border:1px solid #ddd; border-radius:12px;">
        <h2 style="color:#0ea5e9;">Selamat Datang di Masprinto!</h2>
        <p>Anda belum terdaftar sebagai Mitra. Klik tombol di bawah untuk langsung mendaftar:</p>
        ${draft ? '<p style="background:#f0f9ff; padding:10px; border-radius:8px; font-size:13px;">📎 Desain <strong>' + draft + '</strong> akan otomatis terhubung ke akun Anda setelah pendaftaran.</p>' : ''}
        <div style="text-align:center; margin:20px 0;">
          <a href="${registerLink}" style="background:#0ea5e9; color:white; padding:15px 30px; border-radius:10px; text-decoration:none; font-weight:bold; font-size:16px;">DAFTAR MITRA SEKARANG</a>
        </div>
        <p style="color:#64748b; font-size:12px;">Setelah mendaftar, Anda akan mendapatkan akses ke Dashboard Mitra.</p>
      </div>`;
      
      MailApp.sendEmail({ to: query, subject: "Daftar Menjadi Mitra Masprinto", htmlBody: regHtml });
      
      return { status: "Sukses", message: "Email Anda belum terdaftar. Link pendaftaran telah dikirim ke " + query + ". Silakan cek inbox atau folder spam." };
    }

    // ======= MITRA LAMA (Ditemukan) → Hubungkan Desain & Kirim Magic Link =======
    const targetEmail = matchingMitra[0].email;
    const targetIdMitra = matchingMitra[0].idMitra;

    // OTOMATIS HUBUNGKAN DESAIN KE MITRA (Jika ada draftId)
    if (draft) {
      const sheetDesain = ss.getSheetByName("Database_Desain");
      const dataDesain = sheetDesain.getDataRange().getValues();
      for (let i = 1; i < dataDesain.length; i++) {
        if (dataDesain[i][0].toString().trim() === draft) {
          sheetDesain.getRange(i + 1, 5).setValue("Active"); // Status: Active
          sheetDesain.getRange(i + 1, 7).setValue(targetIdMitra); // ID Mitra di kolom G
          break;
        }
      }
    }
    const scriptProp = PropertiesService.getScriptProperties();
    const lastEmailTime = Number(scriptProp.getProperty("last_email_" + targetEmail) || 0);
    const now = new Date().getTime();
    if (now - lastEmailTime < 10000) return { status: "Error", message: "Tunggu sebentar (Anti-Spam 10 detik)." };

    let linksHtml = "";
    matchingMitra.forEach(m => {
      const tempToken = generateTempToken("MITRA", m.idMitra);
      const dashLink = ScriptApp.getService().getUrl() + "?page=dashboard&token=" + tempToken;
      linksHtml += `<div style="margin-bottom:15px; padding:10px; background:#f8fafc; border-radius:8px;">
        <strong>Toko: ${m.namaToko}</strong><br>
        <a href="${dashLink}" style="color:#4f46e5; font-weight:bold;">Masuk Dashboard &raquo;</a>
      </div>`;
    });

    const htmlBody = `<div style="font-family:Arial; padding:20px; border:1px solid #ddd; border-radius:12px;">
      <h2>Halo Mitra!</h2>
      <p>Berikut adalah link akses dashboard Anda:</p>
      ${linksHtml}
      <p style="color:red; font-size:12px;">*Link berlaku 24 jam.</p>
    </div>`;

    MailApp.sendEmail({ to: targetEmail, subject: "Akses Dashboard Mitra Masprinto", htmlBody: htmlBody });
    scriptProp.setProperty("last_email_" + targetEmail, now.toString());
    
    return { status: "Sukses", message: "Link akses dashboard telah dikirim ke email terdaftar Anda. Silakan cek inbox atau folder spam." };
  } catch (e) { return { status: "Error", message: e.toString() }; }
}

function getMitraDataByEmail(email) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Data_Mitra");
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      // Kolom E (Index 4) = Email Owner, Kolom C (Index 2) = Nama Brand, Kolom D (Index 3) = WA
      if (data[i][4].toString().toLowerCase().trim() === email.toLowerCase().trim()) {
        return { idMitra: data[i][1], namaToko: data[i][2], email: data[i][4], wa: data[i][3] };
      }
    }
  } catch (e) {}
  return null;
}

/**
 * KIRIM LINK LOGIN MITRA UNTUK REGISTRASI DESIGN (Magic Link)
 */
function sendMitraLoginLink(emailOrId, idOrder, pin) {
  try {
    if (isSystemOffline()) return { status: "Error", message: "Sistem sedang dalam perbaikan." };

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Data_Mitra");
    const data = sheet.getDataRange().getValues();
    const query = emailOrId.toString().toLowerCase().trim();
    
    let m = null;
    for (let i = 1; i < data.length; i++) {
      // Kolom B (Index 1) = ID Mitra, Kolom E (Index 4) = Email Owner
      if (data[i][1].toString().toLowerCase().trim() === query || data[i][4].toString().toLowerCase().trim() === query) {
        m = { idMitra: data[i][1], namaToko: data[i][2], email: data[i][4] }; // Kolom C (Index 2) = Nama Brand
        break;
      }
    }

    if (!m) return { status: "Sukses", message: "Jika terdaftar, link login dikirim ke email Anda." };

    const tempToken = generateTempToken("MITRA", m.idMitra);
    const loginLink = ScriptApp.getService().getUrl() + "?page=mitra&id=" + idOrder + "&pin=" + pin + "&token=" + tempToken;

    const htmlBody = `<div style="font-family:Arial; padding:20px; border:1px solid #ddd; border-radius:12px;">
      <h2>Halo, ${m.namaToko}!</h2>
      <p>Gunakan link di bawah ini untuk melanjutkan pendaftaran desain baru Anda tanpa perlu mengisi ulang profil:</p>
      <a href="${loginLink}" style="display:inline-block; background:#4f46e5; color:white; padding:12px 20px; text-decoration:none; border-radius:8px; font-weight:bold;">LANJUTKAN PENDAFTARAN &raquo;</a>
      <p style="color:red; font-size:12px; margin-top:20px;">*Link berlaku 24 jam.</p>
    </div>`;

    MailApp.sendEmail({ to: m.email, subject: "Login Mitra Masprinto - Desain Baru", htmlBody: htmlBody });
    
    return { status: "Sukses", message: "Link login telah dikirim ke email " + m.email };
  } catch (e) { return { status: "Error", message: e.toString() }; }
}

/**
 * FASE 3: SINKRONISASI DRAFT (SUPER APP)
 * Mengklaim draft desain dari Local Storage dan mengikatnya ke Mitra.
 */
function claimDraftDesign(token, sessionToken, draftId) {
  const lock = LockService.getUserLock();
  try {
    lock.waitLock(10000);
    
    // Validasi Sesi
    if (!sessionToken) return { status: "Error", message: "Akses ditolak." };
    const isValidSession = validateTempToken(sessionToken, "DASHBOARD_SESSION");
    if (!isValidSession) return { status: "Error", message: "Sesi kadaluwarsa." };

    const mitra = validateMitraAuth(token);
    if (!mitra) return { status: "Error", message: "Sesi tidak valid." };

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Database_Desain");
    const data = sheet.getDataRange().getValues();
    
    // Header Data_Desain: ID Desain, Link Drive, Kode Area, Timestamp, Status, PIN, ID Mitra
    // Kita tambahkan kolom ID Mitra di kolom G (Index 6)
    
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString().trim() === draftId.toString().trim()) {
        let currentStatus = data[i][4].toString().trim();
        
        // Hanya klaim jika statusnya Draft atau kosong
        if (currentStatus === "Draft" || currentStatus === "") {
          sheet.getRange(i + 1, 5).setValue("Active"); // Update Status
          sheet.getRange(i + 1, 7).setValue(mitra.idMitra); // Update ID Mitra (Kolom G)
          found = true;
        } else {
          return { status: "Error", message: "Desain ini sudah diklaim atau aktif." };
        }
        break;
      }
    }
    
    if (found) {
      return { status: "Sukses", message: "Desain berhasil diklaim dan dimasukkan ke galeri Anda!" };
    } else {
      return { status: "Error", message: "ID Draft tidak ditemukan." };
    }

  } catch (e) {
    return { status: "Error", message: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Soft delete pesanan dari dashboard mitra.
 */
function deleteMitraOrder(token, sessionToken, invoiceId) {
  try {
    if (!sessionToken) return { status: "Error", message: "Akses ditolak." };
    const isValidSession = validateTempToken(sessionToken, "DASHBOARD_SESSION");
    if (!isValidSession) return { status: "Error", message: "Sesi kadaluwarsa." };
    const mitra = validateMitraAuth(token);
    if (!mitra) return { status: "Error", message: "Sesi tidak valid." };

    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Order");
    const data = sheet.getDataRange().getValues();
    const inv = (invoiceId || "").toString().trim().toUpperCase();
    const tid = (mitra.idMitra || "").toString().trim().toUpperCase();

    for (let i = 1; i < data.length; i++) {
      const rowInv = (data[i][1] || "").toString().trim().toUpperCase();
      const rowTid = (data[i][3] || "").toString().trim().toUpperCase();
      if (rowInv === inv && rowTid === tid) {
        sheet.getRange(i + 1, 22).setValue("Dihapus Mitra");
        return { status: "Sukses", message: "Pesanan berhasil dihapus dari daftar." };
      }
    }
    return { status: "Error", message: "Pesanan tidak ditemukan." };
  } catch (e) {
    return { status: "Error", message: e.toString() };
  }
}
