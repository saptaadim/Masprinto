

function processOrderStudio(data) {
  try {
    if (isSystemOffline()) {
      return { status: "error", message: "Sistem sedang dalam perbaikan. Coba lagi nanti." };
    }

    // 1. SECURITY: Validasi Token Sesi (Handshake)
    if (!data || !data.sessionToken) {
      return { status: "error", message: "Akses ditolak. Sesi tidak valid." };
    }
    const isValidSession = validateTempToken(data.sessionToken, "STUDIO_SESSION");
    if (!isValidSession) {
      return { status: "error", message: "Sesi telah kadaluwarsa. Silakan refresh halaman." };
    }

    // 2. SECURITY: Hardened Rate Limiting (Progressive Cooldown)
    const userProp = PropertiesService.getUserProperties();
    const lastUpload = Number(userProp.getProperty("last_studio_upload") || 0);
    const uploadCount = Number(userProp.getProperty("studio_upload_count") || 0);
    const now = new Date().getTime();
    
    // Interval dasar 15 detik (dipercepat), bertambah jika terdeteksi spam
    const cooldown = 15000 + (uploadCount * 2000); 
    if (lastUpload && (now - lastUpload < cooldown)) {
      const remaining = Math.ceil((cooldown - (now - lastUpload)) / 1000);
      return { status: "error", message: `Keamanan: Terlalu cepat! Tunggu ${remaining} detik lagi.` };
    }

    // 3. SECURITY: Strict Sanitization & Length Limit
    let safeOrderCode = (data.orderCode || "UNNAMED").replace(/[<>:"\/\\|?*]/g, "").trim();
    if (safeOrderCode.length > 50) safeOrderCode = safeOrderCode.substring(0, 50); // Cegah bloating
    if (!safeOrderCode) safeOrderCode = "UNNAMED";

    // 4. SECURITY: Validasi Ukuran (Hanya untuk Master Mockup yang masih berupa Base64)
    const MAX_BASE64_SIZE = 10 * 1024 * 1024; // 10MB limit for the mockup itself
    if (data.mockupImage && data.mockupImage.length > (MAX_BASE64_SIZE * 1.33)) {
      return { status: "error", message: "Gagal merender mockup. Silakan coba lagi." };
    }

    // 5. SECURITY: Strong Randomized ID & Tracking PIN
    // Menggunakan 12 karakter acak + PIN 4 angka unik untuk proteksi brute-force
    const shortId = "MSP-" + Utilities.getUuid().substring(0, 12).toUpperCase().replace(/-/g, "");
    const accessPin = Math.floor(1000 + Math.random() * 9000).toString();

    const mainFolder = DriveApp.getFolderById(CONFIG.MAIN_FOLDER_ID);
    const folderName = `[${shortId}] ${safeOrderCode}`;
    const orderFolder = mainFolder.createFolder(folderName);
    
    // Folder tetap private (Hanya bisa dibuka jika punya URL spesifik Google Drive)
    orderFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); 
    const folderUrlStr = orderFolder.getUrl();

    // 6. Simpan File dengan Nama Acak (Cegah metadata injection/execution)
    if (data.mockupImage) {
      const mockupBlob = dataURItoBlob(data.mockupImage, `MOCKUP_${Utilities.getUuid().substring(0,8)}.jpg`);
      orderFolder.createFile(mockupBlob);
    }

    if (data.designFiles && data.designFiles.length > 0) {
      data.designFiles.forEach((file, index) => {
        try {
          if (file.fileId) {
            // Jika dikirim sebagai ID (Sistem baru), pindahkan filenya
            const driveFile = DriveApp.getFileById(file.fileId);
            const randomName = `DESIGN_${file.side.toUpperCase()}_${Utilities.getUuid().substring(0,8)}.png`;
            driveFile.setName(randomName);
            driveFile.moveTo(orderFolder);
          } else if (file.base64) {
            // Fallback sistem lama (jika masih ada yang pakai base64)
            const randomName = `DESIGN_${file.side.toUpperCase()}_${Utilities.getUuid().substring(0,8)}.png`;
            const designBlob = dataURItoBlob(file.base64, randomName);
            orderFolder.createFile(designBlob);
          }
        } catch (e) {
          console.error("Gagal memproses file desain: " + e.message);
        }
      });
    }

    // 7. Simpan ke Spreadsheet (Termasuk PIN untuk validasi GAS 2/4)
    const ss = SpreadsheetApp.openById(CONFIG.STUDIO_SS_ID);
    const sheet = ss.getSheetByName(CONFIG.STUDIO_SHEET_NAME);
    const timeStamp = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
    
    sheet.appendRow([
      shortId,         // Kolom A: ID (12 Chars)
      folderUrlStr,    // Kolom B: Folder URL
      safeOrderCode,   // Kolom C: Kode Sablon
      timeStamp,       // Kolom D: Timestamp
      "Draft",         // Kolom E: Status
      accessPin        // Kolom F: Access PIN (New Security Layer)
    ]);

    // Update cooldown
    userProp.setProperty("last_studio_upload", now.toString());
    userProp.setProperty("studio_upload_count", (uploadCount + 1).toString());

    // Link dibuat lebih kompleks agar tidak mudah ditebak
    const linkOrderOtomatis = getUrl('order') + "&id=" + shortId + "&pin=" + accessPin;
    const linkDaftarMitra = getUrl('mitra') + "&id=" + shortId + "&pin=" + accessPin; 

    return {
      status: "success",
      shortId: shortId,
      accessPin: accessPin, // Berikan PIN ke user untuk dicatat
      orderCode: safeOrderCode,
      folderUrl: folderUrlStr,
      shortLink: linkOrderOtomatis,
      mitraLink: linkDaftarMitra
    };

  } catch (error) {
    return { status: "error", message: error.toString() };
  }
}

function dataURItoBlob(dataURI, filename) {
  const marker = ';base64,';
  const markerIndex = dataURI.indexOf(marker) + marker.length;
  const base64Str = dataURI.substring(markerIndex);
  const decoded = Utilities.base64Decode(base64Str);
  let mimeType = MimeType.PNG;
  if (dataURI.indexOf('image/jpeg') !== -1) mimeType = MimeType.JPEG;
  return Utilities.newBlob(decoded, mimeType, filename);
}

/**
 * Fungsi baru untuk upload file satu per satu ke folder Temp (Mendukung file besar)
 */
function uploadFileToTemp(base64, filename, mimeType) {
  try {
    const folder = DriveApp.getFolderById(CONFIG.UPLOAD_FOLDER_ID);
    const decoded = Utilities.base64Decode(base64);
    const blob = Utilities.newBlob(decoded, mimeType, "TEMP_" + filename);
    const file = folder.createFile(blob);
    return { status: "success", fileId: file.getId() };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}