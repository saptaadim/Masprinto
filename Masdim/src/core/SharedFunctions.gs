/**
 * FUNGSI AMBIL DATA HARGA (Dipakai GAS 2, 3, 4)
 */
function getPricingData() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Harga");
    if (!sheet) throw new Error("Sheet 'Harga' tidak ditemukan di Master!");
    
    const data = sheet.getDataRange().getValues();
    let config = { kaos: {}, sablonSatuan: {}, sablonGrosir: {} };
    
    for (let i = 1; i < data.length; i++) {
      let kode = data[i][0] ? data[i][0].toString().trim().toUpperCase() : "";
      let rawVal = data[i][1];
      
      if (kode !== "") {
        let harga = 0;
        if (typeof rawVal === 'number') {
          harga = rawVal;
        } else if (rawVal) {
          harga = Number(rawVal.toString().replace(/[^0-9,-]+/g,"").replace(",", ".")) || 0;
        }

        if (kode.startsWith("KAOS_")) {
          config.kaos[kode] = harga; 
        } else if (kode.startsWith("SABLON_")) {
          let isGrosir = kode.endsWith("_GROSIR");
          let isSatuan = kode.endsWith("_SATUAN");
          
          let ukuranSablon = kode.replace("SABLON_", "").replace("_SATUAN", "").replace("_GROSIR", "");
          
          if (isSatuan) config.sablonSatuan[ukuranSablon] = harga;
          if (isGrosir) config.sablonGrosir[ukuranSablon] = harga;
        }
      }
    }
    return config;
  } catch(e) {
    throw new Error("Gagal tarik harga Master: " + e.message);
  }
}

/**
 * FUNGSI AMBIL DATA DARI STUDIO (Dipakai GAS 2 & GAS 3)
 */
function getDataFromStudio(orderId) {
  try {
    const ssStudio = SpreadsheetApp.openById(CONFIG.STUDIO_SS_ID);
    const sheetStudio = ssStudio.getSheetByName("Database_Desain"); 
    if (!sheetStudio) throw new Error("Sheet 'Database_Desain' tidak ditemukan di Studio.");
    
    const data = sheetStudio.getDataRange().getValues();
    let targetId = orderId.toString().trim().toUpperCase();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString().trim().toUpperCase() === targetId) { 
        var rawUrl = data[i][1].toString().trim();
        // Ekstrak Folder ID dari URL lengkap, atau gunakan apa adanya jika sudah ID murni
        var folderIdExtracted = rawUrl;
        if (rawUrl.indexOf("/folders/") !== -1) {
          folderIdExtracted = rawUrl.split("/folders/")[1].split("?")[0];
        }
        return {
          folderId: folderIdExtracted,
          folderUrl: rawUrl,
          kodeSablon: data[i][2].toString().trim()
        };
      }
    }
    // Fallback: cek di Master Database_Desain (beberapa alur simpan draft langsung ke master)
    try {
      const ssMaster = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
      const sheetMasterDesain = ssMaster.getSheetByName("Database_Desain");
      if (sheetMasterDesain) {
        const dataMaster = sheetMasterDesain.getDataRange().getValues();
        for (let j = 1; j < dataMaster.length; j++) {
          if ((dataMaster[j][0] || "").toString().trim().toUpperCase() === targetId) {
            const rawUrlMaster = (dataMaster[j][1] || "").toString().trim();
            let folderIdMaster = rawUrlMaster;
            if (rawUrlMaster.indexOf("/folders/") !== -1) {
              folderIdMaster = rawUrlMaster.split("/folders/")[1].split("?")[0];
            }
            return {
              folderId: folderIdMaster,
              folderUrl: rawUrlMaster,
              kodeSablon: (dataMaster[j][2] || "").toString().trim()
            };
          }
        }
      }
    } catch (ignoreErr) {}

    return null;
  } catch (e) {
    throw new Error(e.message);
  }
}

/**
 * FUNGSI CEK STATUS MAINTENANCE (Sinkron dengan Super Admin via Spreadsheet)
 * Mengambil data dari sheet _CONFIG_ di Master Spreadsheet
 */
function isSystemOffline() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    let sheetConfig = ss.getSheetByName("_CONFIG_");
    if (!sheetConfig) return false;
    
    const data = sheetConfig.getDataRange().getValues();
    // Cari key MAINTENANCE_MODE di kolom A, value di kolom B
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === "MAINTENANCE_MODE") {
        return data[i][1].toString().toLowerCase() === "true";
      }
    }
    return false;
  } catch (e) {
    console.error("Gagal cek status maintenance: " + e.toString());
    return false;
  }
}

/**
 * AMBIL DATA MITRA BERDASARKAN ID MITRA
 */
function getMitraDataById(idMitra) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Data_Mitra");
    const data = sheet.getDataRange().getValues();
    const id = idMitra.toString().trim().toUpperCase();
    for (let i = 1; i < data.length; i++) {
      if (data[i][1].toString().trim().toUpperCase() === id) {
        return { 
          idMitra: data[i][1], 
          namaToko: data[i][2], 
          wa: data[i][3], 
          email: data[i][4], 
          idOrder: data[i][5],
          kodeSablon: data[i][6],
          kainDefault: data[i][7], 
          warnaDefault: data[i][8],
          profit: data[i][9],
          bankName: data[i][10],
          bankAcc: data[i][11],
          bankOwner: data[i][12],
          alamat: data[i][13],
          token: data[i][14]
        };
      }
    }
    return null;
  } catch (e) { return null; }
}

/**
 * AMBIL DATA MITRA BERDASARKAN STATIC TOKEN
 */
function getMitraDataByToken(token) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Data_Mitra");
    const data = sheet.getDataRange().getValues();
    const t = token.toString().trim();
    for (let i = 1; i < data.length; i++) {
      if (data[i][14] && data[i][14].toString().trim() === t) {
        return getMitraDataById(data[i][1]);
      }
    }
    return null;
  } catch (e) { return null; }
}