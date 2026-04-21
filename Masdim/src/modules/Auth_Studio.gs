/**
 * Auth_Studio.gs
 * Modul untuk menangani token akses sementara (Expiring Links)
 */

function generateTempToken(type, targetId) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    
    // ANTI-SPAM: Cek cooldown 60 detik per ID (Hanya untuk non-GUEST)
    const userProp = PropertiesService.getUserProperties();
    const lastRequest = userProp.getProperty("last_request_" + targetId);
    const nowTime = new Date().getTime();
    if (targetId !== "GUEST" && lastRequest && (nowTime - lastRequest < 5000)) {
      throw new Error("Tunggu 5 detik (Anti-Spam).");
    }
    if (targetId !== "GUEST") userProp.setProperty("last_request_" + targetId, nowTime.toString());

    let sheet = ss.getSheetByName("Session_Tokens");
    if (!sheet) {
      sheet = ss.insertSheet("Session_Tokens");
      sheet.appendRow(["Token", "Type", "Target_ID", "Created_At", "Expires_At", "Is_Used"]);
      sheet.getRange("A1:F1").setFontWeight("bold").setBackground("#f1f5f9");
    }

    const token = "TKN-" + Utilities.getUuid().slice(0, 8).toUpperCase() + "-" + Math.floor(Math.random() * 1000);
    const now = new Date();
    const expiry = new Date(now.getTime() + (24 * 60 * 60 * 1000)); // 24 Jam
    const expiryTimestamp = expiry.getTime(); // Simpan sebagai timestamp agar kebal timezone

    sheet.appendRow([token, type, targetId, now, expiryTimestamp, "No"]);

    // AUTO-CLEANUP: Hapus token lama (> 48 jam) secara berkala (Probabilitas 10%)
    if (Math.random() < 0.1) {
      const threshold = now.getTime() - (48 * 60 * 60 * 1000);
      const allData = sheet.getDataRange().getValues();
      for (let i = allData.length - 1; i >= 1; i--) {
        const created = new Date(allData[i][3]).getTime();
        if (created < threshold) {
          sheet.deleteRow(i + 1);
        }
      }
    }

    return token;
  } catch (e) {
    console.error("Error generating token: " + e.message);
    return null;
  }
}

function validateTempToken(token, expectedType) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.MASTER_SS_ID);
    const sheet = ss.getSheetByName("Session_Tokens");
    if (!sheet) return null;

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return null;
    
    // OPTIMASI: Ambil 5000 baris terakhir (Mencegah token 'terdorong' keluar saat traffic tinggi/bot)
    const startRow = Math.max(2, lastRow - 5000);
    const numRows = (lastRow - startRow) + 1;
    const data = sheet.getRange(startRow, 1, numRows, 6).getValues();
    
    const now = new Date().getTime();
    const typeUpper = expectedType.toString().toUpperCase().trim();
    const tokenClean = token.toString().trim();

    for (let i = data.length - 1; i >= 0; i--) { // Scan dari yang terbaru (bawah ke atas)
      const tkn = (data[i][0] || "").toString().trim();
      const typ = (data[i][1] || "").toString().toUpperCase().trim();
      const used = (data[i][5] || "").toString().trim();
      
      if (tkn === tokenClean && typ === typeUpper && used === "No") {
        // Handle potential formatting issues (Date object vs Number)
        let expiry = data[i][4];
        if (expiry instanceof Date) {
          expiry = expiry.getTime();
        } else {
          expiry = Number(expiry);
        }

        if (!isNaN(expiry) && now < expiry) {
          // Token Valid - Tandai sebagai 'Used' agar tidak bisa replay attack (Opsional, tapi aman)
          // sheet.getRange(startRow + i, 6).setValue("Yes"); 
          return data[i][2]; // Kembalikan Target_ID
        }
      }
    }
    return null;
  } catch (e) {
    console.error("Auth Error: " + e.message);
    return null;
  }
}
/**
 * VALIDASI GANDA: Cek Magic Link ATAU Static Token
 */
function validateMitraAuth(token) {
  if (!token) return null;
  
  // 1. Cek Temporary Token (Magic Link) - Prioritas
  const tempId = validateTempToken(token, "MITRA");
  if (tempId) return getMitraDataById(tempId);
  
  // 2. Cek Static Token (Spreadsheet) - Fallback
  return getMitraDataByToken(token);
}
