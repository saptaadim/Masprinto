// ==========================================
// PUSAT PENGATURAN (CONSTANTS) - MASPRINTO
// ==========================================
const CONFIG = {
  // ID Spreadsheet Master (Harga, Mitra, Order)
  MASTER_SS_ID: "1ITFrIVE9cD12pji4AlKFBgPvvSfXCRVsAThKUIAvPvE",
  
  // ID Spreadsheet Studio (Database Mockup dari GAS 1)
  STUDIO_SS_ID: "1ITFrIVE9cD12pji4AlKFBgPvvSfXCRVsAThKUIAvPvE",
  STUDIO_SHEET_NAME: "Database_Desain",
  
  // Kontak Admin
  ADMIN_WA: "6281231619457",
  EMAIL_OWNER: "saptaadim@gmail.com",
  
  // ID Folder Google Drive untuk Upload File
  UPLOAD_FOLDER_ID: "1iWF8G5-4i3xrubAzVQ2KAbV4n0S0K4Mq",
  MAIN_FOLDER_ID: "1qBGiZRryEacKk3dXoHpbZXrYSU_3ClBN"
};

// Helper: Generate URL otomatis
function getUrl(page) {
  const baseUrl = ScriptApp.getService().getUrl();
  return page ? baseUrl + "?page=" + page : baseUrl;
}