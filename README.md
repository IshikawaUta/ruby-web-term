# Eksa Web Terminal 🚀

A premium, feature-rich web-based terminal shell built with Ruby Rack and EksaServer. Designed for developers who want a beautiful, secure, and powerful terminal accessible via the browser.

## ✨ Fitur Utama

- **Premium UI/UX**: Tampilan modern dengan *Glassmorphism*, dua baris prompt, dan animasi halus.
- **Zsh-style Enhancements**:
    - **Syntax Highlighting**: Validasi perintah secara real-time (Hijau/Merah).
    - **Autosuggestions**: Prediksi perintah berdasarkan riwayat (Ghost Text).
    - **Tab Autocomplete**: Melengkapi nama file dan folder secara instan.
- **Web-Based Editor (Nano Alternative)**: Editor kode bawaan (Ace Editor) dengan *syntax highlighting* dan shortcut keyboard (`Ctrl+S`, `Esc`).
- **Security & Jailing**:
    - **Sandboxed Navigation**: Terkunci di dalam folder project (tidak bisa keluar ke folder sistem).
    - **Protected Files**: Menyembunyikan dan memproteksi file core sistem terminal.
    - **Authentication**: Proteksi password yang kuat via Environment Variables.
- **Ultimate Power-ups**:
    - **Process Control**: Tekan `Ctrl+C` untuk menghentikan proses (SIGINT).
    - **Drag & Drop Upload**: Tarik file dari komputer langsung ke terminal untuk upload.
    - **Persistent History**: Riwayat perintah tersimpan di browser.

## 🚀 Persiapan & Instalasi

### 1. Prasyarat
- Ruby 3.x
- Bundler

### 2. Instalasi
```bash
git clone https://github.com/IshikawaUta/ruby-web-term.git
cd ruby-web-term
bundle install
```

### 3. Menjalankan Server
```bash
# Set password (opsional, default: password)
export TERMINAL_PASSWORD="your_secret_password"

# Jalankan server
bundle exec eksa-server
```
Buka `http://localhost:3000` di browser Anda.

## 🛠️ Konfigurasi Environment Variables

| Variable | Deskripsi | Default |
|----------|-----------|---------|
| `TERMINAL_PASSWORD` | Password untuk akses web terminal | `password` |
| `PORT` | Port server | `3000` |

## 🛡️ Keamanan (Warning)
Proyek ini memberikan akses shell ke server Anda. **Sangat disarankan** untuk:
1. Menggunakan password yang kuat.
2. Mendeploy di repository **Private**.
3. Hanya digunakan untuk keperluan pengembangan atau akses remote yang terkendali.

## 📜 Lisensi
Proyek ini dilisensikan di bawah [MIT License](LICENSE).