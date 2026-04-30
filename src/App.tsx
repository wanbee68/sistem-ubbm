import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  initializeFirestore, 
  collection, 
  addDoc, 
  onSnapshot, 
  deleteDoc, 
  doc, 
  query,
  where,
  orderBy,
  getDocs,
  writeBatch,
  getDocFromServer
} from 'firebase/firestore';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  User,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  Save, Printer, Trash2, FileText, History, 
  UserCheck, ShieldCheck, Search, Eye,
  PenTool, CheckCircle2, ListChecks, Upload, X,
  BookOpen, HelpCircle, ChevronRight, Info
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';

// Firebase Configuration
import firebaseConfig from '../firebase-applet-config.json';
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);
const appId = 'ubbm-system-2026';

// PDF and Excel Workers/Config
// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const TINGKATAN_OPTIONS = ['1', '2', '3', '4', '5'];
const KELAS_OPTIONS = ['AMANAH', 'BESTARI', 'CEMERLANG', 'DINAMIK', 'EFISIEN', 'FASIH'];
const JENIS_UJIAN_OPTIONS = [
  'Peperiksaan Semester 1',
  'Peperiksaan Semester 2',
  'Peperiksaan SPMRSM'
];

interface Candidate {
  nama: string;
  jantina: string;
  noMaktab: string;
  homeroom: string;
  tingkatan: string;
  kelas: string;
  analitik: {
    tatabahasa: string | number;
    sebutan: string | number;
    kefasihan: string | number;
    idea: string | number;
  };
  holistik: string | number;
}

const INITIAL_HEADER = {
    jenisUjian: JENIS_UJIAN_OPTIONS[0],
    namaMaktab: 'MAKTAB RENDAH SAINS MARA ',
    sidang: '1',
    tarikhMasa: '',
    pemeriksaNama: '',
    pemeriksaJawatan: 'Guru Bahasa Melayu',
    penyemakNama: '',
    penyemakJawatan: 'Ketua Jabatan Bahasa',
    pengesahNama: '',
    pengesahJawatan: 'Timbalan Pengetua Kecemerlangan Akademik',
    tarikhSemak: new Date().toLocaleDateString('ms-MY'),
    tarikhSah: new Date().toLocaleDateString('ms-MY')
};

const emptyCandidate = (): Candidate => ({
  nama: '',
  jantina: 'L',
  noMaktab: '',
  homeroom: '',
  tingkatan: '1',
  kelas: 'AMANAH',
  analitik: { tatabahasa: '', sebutan: '', kefasihan: '', idea: '' },
  holistik: ''
});

const App = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<any[]>([]);
  const [studentDb, setStudentDb] = useState<any[]>(() => {
    try {
      const cached = localStorage.getItem('ubbm_student_db_cache');
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  }); 
  const [loadingStudentDb, setLoadingStudentDb] = useState(true);
  const [isSavingDb, setIsSavingDb] = useState(false);
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isPdfReady, setIsPdfReady] = useState(true);
  const [notification, setNotification] = useState({ show: false, message: '', type: 'info' });
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    confirmText: string;
    variant: 'danger' | 'warning' | 'info';
  }>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => {},
    confirmText: 'Teruskan',
    variant: 'info'
  });
  const [showManual, setShowManual] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [searchModal, setSearchModal] = useState<{show: boolean, targetIdx: number | null, term: string, tingkatan?: string, kelas?: string}>({ show: false, targetIdx: null, term: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Form State
  const [header, setHeader] = useState(INITIAL_HEADER);

  const [candidates, setCandidates] = useState<Candidate[]>(Array(5).fill(null).map(emptyCandidate));

  // --- LOGIK KEMASUKAN MARKAH ---

  const handleAnalitikChange = (idx: number, field: keyof Candidate['analitik'], val: string) => {
    const newCandidates = [...candidates];
    const candidate = { ...newCandidates[idx] };
    const analitik = { ...candidate.analitik };

    if (val === '') {
      analitik[field] = '';
      candidate.analitik = analitik;
      newCandidates[idx] = candidate;
      setCandidates(newCandidates);
      return;
    }

    let num = parseInt(val);
    if (isNaN(num)) return;
    num = Math.max(0, Math.min(10, num));
    
    analitik[field] = num;
    candidate.analitik = analitik;
    newCandidates[idx] = candidate;
    setCandidates(newCandidates);
  };

  const handleHolistikChange = (idx: number, val: string) => {
    const newCandidates = [...candidates];
    const candidate = { ...newCandidates[idx] };

    if (val === '') {
      candidate.holistik = '';
      newCandidates[idx] = candidate;
      setCandidates(newCandidates);
      return;
    }

    let num = parseInt(val);
    if (isNaN(num)) return;
    num = Math.max(0, Math.min(30, num));
    
    candidate.holistik = num;
    newCandidates[idx] = candidate;
    setCandidates(newCandidates);
  };

  const calculateAnalitikTotal = (c: Candidate) => {
    if (!c || !c.analitik) return 0;
    return (Number(c.analitik.tatabahasa) || 0) + 
           (Number(c.analitik.sebutan) || 0) + 
           (Number(c.analitik.kefasihan) || 0) + 
           (Number(c.analitik.idea) || 0);
  };

  // --- LOGIK MUAT NAIK & PEMETAAN DATA (DIPERBAIKI) ---

  const parseRow = (row: any[]) => {
    let name = "", hr = "", noM = "", ting = "1", kls = "AMANAH";
    
    row.forEach((cell) => {
      const s = String(cell || "").trim();
      if (!s) return;
      const upperS = s.toUpperCase();

      // 1. Cek Tingkatan (1-5)
      if (TINGKATAN_OPTIONS.includes(s)) {
        ting = s;
      } 
      // 2. Cek Kelas (Dropdown: Amanah, Bestari, dll)
      else if (KELAS_OPTIONS.includes(upperS)) {
        kls = upperS;
      }
      // 3. Cek Kod Homeroom (A hingga N sahaja)
      else if (/^[A-N]$/i.test(s)) {
        hr = upperS;
      }
      // 4. Cek Nama (Panjang > 2, tiada digit, bukan kata kunci header)
      else if (s.length > 2 && !/\d/.test(s)) {
        const headerKeywords = ["NAMA", "NAME", "NO.", "NO", "MAKTAB", "TING", "KELAS", "HOMEROOM", "STUDENT", "PELAJAR"];
        if (!headerKeywords.includes(upperS)) {
          name = upperS;
        }
      }
      // 5. Cek No Maktab (Biasanya 4-10 karakter, ada digit)
      else if (s.length >= 4 && s.length <= 12 && /\d/.test(s)) {
        noM = s;
      }
    });

    return { 
      nama: name, 
      homeroom: hr, 
      noMaktab: noM, 
      tingkatan: ting, 
      kelas: kls 
    };
  };

  const selectStudent = (student: any) => {
    const newCandidates = [...candidates];
    const idx = searchModal.targetIdx;
    if (idx === null) return;
    
    newCandidates[idx] = {
      ...newCandidates[idx],
      nama: String(student.nama || ""),
      homeroom: String(student.homeroom || ""),
      noMaktab: String(student.noMaktab || ""),
      tingkatan: TINGKATAN_OPTIONS.includes(student.tingkatan) ? student.tingkatan : '1',
      kelas: KELAS_OPTIONS.includes(student.kelas) ? student.kelas : 'AMANAH'
    };
    
    setCandidates(newCandidates);
    setSearchModal({ show: false, targetIdx: null, term: '' });
    showToast(`Pelajar ${student.nama} (HR: ${student.homeroom}) dimasukkan`);
  };

  // --- UTILITI SISTEM ---

  const showToast = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    setNotification({ show: true, message: String(msg), type });
    setTimeout(() => setNotification({ show: false, message: '', type: 'info' }), 5000);
  };

  const resetForm = () => {
    setConfirmModal({
      show: true,
      title: "Kosongkan Borang",
      message: "Adakah anda pasti? Semua maklumat markah yang sedang diisi akan dipadamkan sepenuhnya. Rekod di dalam arkib tidak akan terjejas.",
      confirmText: "Kosongkan Sekarang",
      variant: 'danger',
      onConfirm: () => {
        try {
          showToast("Sistem sedang memproses pembersihan data...", "info");
          
          // Use distinct state updates with fresh objects
          setCandidates([
            emptyCandidate(), emptyCandidate(), emptyCandidate(), emptyCandidate(), emptyCandidate()
          ]);

          setHeader(prev => {
            const h = {
              ...INITIAL_HEADER,
              pemeriksaNama: prev.pemeriksaNama,
              pemeriksaJawatan: prev.pemeriksaJawatan,
              penyemakNama: prev.penyemakNama,
              penyemakJawatan: prev.penyemakJawatan,
              pengesahNama: prev.pengesahNama,
              pengesahJawatan: prev.pengesahJawatan,
              tarikhMasa: ''
            };
            return h;
          });

          // Reset UI States
          setConfirmingDelete(null);
          setIsPdfReady(false);
          setSearchModal({ show: false, targetIdx: null, term: '' });
          
          window.scrollTo({ top: 0, behavior: 'smooth' });
          
          // Delay the success toast slightly to ensure UX visibility
          setTimeout(() => {
            showToast("Borang telah bersih dan sedia digunakan semula", "success");
          }, 300);

        } catch (error) {
          console.error("Critical Reset Error:", error);
          showToast("Gagal mengosongkan borang secara automatik. Sila muat semula halaman.", "error");
        } finally {
          // Close modal last
          setConfirmModal(prev => ({ ...prev, show: false }));
        }
      }
    });
  };

  const saveRecord = async () => {
    if (!user) return;
    const activeCandidates = candidates.filter(c => c.nama && c.nama.trim() !== '');
    if (activeCandidates.length === 0) {
      alert("Sila isi sekurang-kurangnya satu nama calon sebelum menyimpan.");
      return;
    }
    
    setIsSavingRecord(true);
    const path = `artifacts/${appId}/public/data/ubbm_records`;
    try {
      const saveDate = new Date();
      await addDoc(collection(db, path), {
        header: { 
          ...header, 
          tarikhSimpan: saveDate.toLocaleDateString('ms-MY'), 
          masaSimpan: saveDate.toLocaleTimeString('ms-MY') 
        },
        candidates: activeCandidates,
        createdAt: saveDate.toISOString(),
        userId: user.uid
      });
      showToast("Rekod berjaya disimpan ke arkib");
    } catch (err) { 
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setIsSavingRecord(false);
    }
  };

  const loadRecord = (record: any) => {
    if (!record) return;
    setHeader(record.header);
    const loaded = [...record.candidates];
    while(loaded.length < 5) loaded.push(emptyCandidate());
    setCandidates(loaded);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast("Rekod dimuat semula");
  };

  const deleteRecord = async (id: string) => {
    if (!user || !window.confirm("Padam rekod ini secara kekal?")) return;
    const path = `artifacts/${appId}/public/data/ubbm_records/${id}`;
    try { 
      await deleteDoc(doc(db, `artifacts/${appId}/public/data/ubbm_records`, id)); 
      showToast("Rekod berjaya dipadam");
    } catch (err) { 
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const openSearch = (idx: number, tingkatan?: string, kelas?: string) => {
    console.log("Search button clicked for index:", idx, tingkatan, kelas);
    console.log("Loading state:", loadingStudentDb);
    console.log("Database size:", studentDb.length);

    if (loadingStudentDb) {
      showToast("Tunggu sebentar, sedang memuat pangkalan data...");
      return;
    }
    if (studentDb.length === 0) {
      showToast("Gagal: Sila muat naik fail maklumat pelajar terlebih dahulu.");
      return;
    }
    setSearchModal({ show: true, targetIdx: idx, term: '', tingkatan, kelas });
  };

  const generatePDF = async () => {
    if (!isPdfReady || isGeneratingPdf) return;
    
    const activeCandidates = candidates.filter(c => c.nama && c.nama.trim() !== '');
    if (activeCandidates.length === 0) {
      alert("Tiada data calon untuk dicetak.");
      return;
    }

    try {
      setIsGeneratingPdf(true);
      showToast("Sedang menjana fail PDF... Sila tunggu.");
      
      const doc = new jsPDF('l', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      
      doc.setFontSize(14);
      doc.text("MAKTAB RENDAH SAINS MARA", pageWidth / 2, 15, { align: 'center' });
      doc.setFontSize(12);
      doc.text("BORANG UJIAN BERTUTUR BAHASA MELAYU (UBBM)", pageWidth / 2, 22, { align: 'center' });
      
      doc.setFontSize(10);
      doc.text(`JENIS UJIAN: ${header.jenisUjian}`, 20, 32);
      doc.text(`SIDANG: ${header.sidang}`, pageWidth - 35, 32);
      doc.text(`TARIKH/MASA: ${header.tarikhMasa || '-'}`, (pageWidth / 2) + 10, 32, { align: 'center' });
      
      const tableData = activeCandidates.map((c, i) => [
        i + 1, 
        `${c.nama || "-"}\nHR: ${c.homeroom || "-"}\nNo.M: ${c.noMaktab || "-"}`,
        `${c.tingkatan} ${c.kelas}`, 
        c.analitik.tatabahasa || 0, c.analitik.sebutan || 0, c.analitik.kefasihan || 0, c.analitik.idea || 0,
        calculateAnalitikTotal(c), c.holistik || 0, calculateAnalitikTotal(c) + Number(c.holistik || 0)
      ]);

      autoTable(doc, {
        startY: 45,
        head: [['BIL', 'MAKLUMAT CALON', 'TING/KLAS', 'TATA', 'SEBUT', 'FASIH', 'IDEA', 'JUM A', 'HOL', 'JUM BSR']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [30, 58, 138], fontSize: 8, halign: 'center' },
        styles: { fontSize: 8, cellPadding: 2, halign: 'center' },
        columnStyles: { 1: { halign: 'left', cellWidth: 70 }, 9: { fontStyle: 'bold' } }
      });

      const finalY = (doc as any).lastAutoTable.finalY + 15;
      doc.text(`Disediakan: ${header.pemeriksaNama || '---'}`, 20, finalY + 10);
      doc.text(`Disemak: ${header.penyemakNama || '---'}`, pageWidth / 2 - 20, finalY + 10);
      doc.text(`Disahkan: ${header.pengesahNama || '---'}`, pageWidth - 70, finalY + 10);

      window.open(doc.output('bloburl'), '_blank');
      showToast("Fail PDF berjaya dijana");
    } catch (err) {
      console.error("PDF Generation Error:", err);
      alert("Ralat semasa menjana PDF.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const generateIndukPDF = async () => {
    if (!isPdfReady || isGeneratingPdf) return;
    if (records.length === 0) {
      alert("Tiada rekod tersimpan di dalam arkib untuk menjana laporan induk.");
      return;
    }

    try {
      setIsGeneratingPdf(true);
      showToast("Menjana Laporan Markah Induk... Sila tunggu.");
      
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFontSize(14);
      doc.text("LAPORAN MARKAH INDUK UBBM", pageWidth / 2, 15, { align: 'center' });
      
      let all: any[] = [];
      records.forEach(r => r.candidates?.forEach((c: any) => c.nama && all.push(c)));
      
      if (all.length === 0) {
        alert("Tiada data calon ditemui dalam rekod arkib.");
        return;
      }

      all.sort((a,b) => (String(a.tingkatan)+String(a.kelas)).localeCompare(String(b.tingkatan)+String(b.kelas)));

      autoTable(doc, {
          startY: 30,
          head: [['BIL', 'NAMA CALON', 'NO. MAKTAB', 'TING', 'KELAS', 'HR', 'INDIVIDU', 'KUMPULAN', 'JUM']],
          body: all.map((c, i) => [
            i+1, 
            c.nama, 
            c.noMaktab, 
            c.tingkatan, 
            c.kelas, 
            c.homeroom || "-",
            calculateAnalitikTotal(c), 
            c.holistik || 0, 
            calculateAnalitikTotal(c) + (Number(c.holistik) || 0)
          ]),
          theme: 'grid',
          headStyles: { fillColor: [30, 58, 138], fontSize: 9 }
      });
      window.open(doc.output('bloburl'), '_blank');
      showToast("Laporan Induk berjaya dijana");
    } catch (err) {
      console.error("Master PDF Error:", err);
      alert("Ralat semasa menjana laporan induk.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const saveStudentDbToFirestore = async (students: any[]) => {
    if (!user) {
      alert("Sila log masuk untuk menyimpan pangkalan data.");
      return;
    }
    const path = `artifacts/${appId}/public/data/student_database`;
    try {
      setIsSavingDb(true);
      showToast("Sedang menyelaraskan data...");
      
      // 1. Generate IDs and clean data
      const processedWithIds = students.map(s => {
        const docId = (s._docId) ? s._docId : 
                     ((s.noMaktab && String(s.noMaktab).trim()) ? String(s.noMaktab).trim() : 
                     doc(collection(db, path)).id);
        return { ...s, _docId: docId };
      });

      // Update local storage first for speed
      localStorage.setItem('ubbm_student_db_cache', JSON.stringify(processedWithIds));
      setStudentDb(processedWithIds);
      
      // 2. Add/Update docs using batches
      const addBatches = [];
      let currentAddBatch = writeBatch(db);
      let opCount = 0;

      for (const s of processedWithIds) {
        const docRef = doc(db, path, s._docId);
        
        currentAddBatch.set(docRef, { 
          ...s, 
          userId: user.uid, 
          updatedAt: new Date().toISOString() 
        });
        
        opCount++;
        if (opCount === 450) {
          addBatches.push(currentAddBatch.commit());
          currentAddBatch = writeBatch(db);
          opCount = 0;
        }
      }
      if (opCount > 0) addBatches.push(currentAddBatch.commit());
      
      await Promise.all(addBatches);
      setIsSavingDb(false);
      showToast(`Berjaya menyelaraskan ${students.length} rekod.`);
    } catch (err) {
      setIsSavingDb(false);
      console.error("Save Student DB Error:", err);
      showToast("Gagal menyelaraskan data sepenuhnya.");
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const deleteStudentRecord = async (student: any) => {
    if (isSavingDb) {
      showToast("Sistem sedang memproses data lain. Sila tunggu.", 'error');
      return;
    }
    
    const docId = student._docId || (student.noMaktab && String(student.noMaktab).trim());
    
    if (!docId) {
      showToast("Ralat: Rekod ini tiada ID unik. Sila gunakan 'SET SEMULA DATA'.", 'error');
      return;
    }

    const path = `artifacts/${appId}/public/data/student_database`;
    try {
      setIsSavingDb(true);
      showToast(`Menghapus ${student.nama}...`, 'info');
      
      const docRef = doc(db, path, String(docId));
      await deleteDoc(docRef);
      
      // Update local state
      setStudentDb(prev => prev.filter(s => {
        const sid = s._docId || s.noMaktab;
        return String(sid) !== String(docId);
      }));
      
      showToast(`Selesai: Rekod dipadam.`, 'success');
    } catch (err: any) {
      console.error("Delete Error details:", err);
      showToast(`Kegagalan: ${err.message || 'Ralat teknikal'}`, 'error');
    } finally {
      setIsSavingDb(false);
      setConfirmingDelete(null);
    }
  };

  const deleteFilteredStudents = async (filteredList: any[]) => {
    if (isSavingDb) {
      showToast("Sistem sibuk. Sila tunggu.", 'error');
      return;
    }
    if (filteredList.length === 0) return;

    const listWithIds = filteredList.filter(s => s._docId || (s.noMaktab && String(s.noMaktab).trim()));

    if (listWithIds.length === 0) {
      showToast("Ralat: Data terpilih tiada ID yang boleh dipadam.", 'error');
      return;
    }

    const path = `artifacts/${appId}/public/data/student_database`;
    try {
      setIsSavingDb(true);
      showToast(`Memadam ${listWithIds.length} rekod...`, 'info');
      
      const batches = [];
      let currentBatch = writeBatch(db);
      let count = 0;
      const deletedIds = new Set();
      
      for (const s of listWithIds) {
        const docId = s._docId || s.noMaktab;
        if (!docId) continue;
        
        currentBatch.delete(doc(db, path, String(docId)));
        deletedIds.add(String(docId));
        count++;
        
        if (count === 400) {
          batches.push(currentBatch.commit());
          currentBatch = writeBatch(db);
          count = 0;
        }
      }
      
      if (count > 0) batches.push(currentBatch.commit());
      await Promise.all(batches);
      
      // UI Update
      setStudentDb(prev => prev.filter(s => {
        const id = s._docId || s.noMaktab;
        return !deletedIds.has(String(id));
      }));
      
      showToast(`Berjaya: ${listWithIds.length} rekod dipadam.`, 'success');
      setSearchModal({ ...searchModal, show: false });
    } catch (err: any) {
      console.error("Bulk Delete Error details:", err);
      showToast(`Ralat: Gagal memadam data.`, 'error');
    } finally {
      setIsSavingDb(false);
      setConfirmingDelete(null);
    }
  };

  const cleanupRedundantData = async () => {
    if (!user || isSavingDb) return;
    if (!window.confirm("Sistem akan membuang rekod pendua secara kekal dari pangkalan data global. Teruskan?")) return;
    
    const path = `artifacts/${appId}/public/data/student_database`;
    try {
      setIsSavingDb(true);
      showToast("Membersihkan data pendua...");
      
      const q = query(collection(db, path));
      const snapshot = await getDocs(q);
      
      const seen = new Set();
      const duplicates: any[] = [];
      
      snapshot.docs.forEach(d => {
        const data = d.data();
        const key = data.noMaktab || d.id;
        if (seen.has(key)) {
          duplicates.push(d.ref);
        } else {
          seen.add(key);
        }
      });
      
      if (duplicates.length === 0) {
        showToast("Tiada data pendua ditemui.");
        setIsSavingDb(false);
        return;
      }
      
      const deleteBatches = [];
      let currentBatch = writeBatch(db);
      let count = 0;
      
      for (const ref of duplicates) {
        currentBatch.delete(ref);
        count++;
        if (count === 450) {
          deleteBatches.push(currentBatch.commit());
          currentBatch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) deleteBatches.push(currentBatch.commit());
      
      await Promise.all(deleteBatches);
      showToast(`Berjaya membuang ${duplicates.length} rekod pendua.`);
    } catch (err) {
      console.error("Cleanup Error:", err);
      showToast("Gagal membersihkan data.");
    } finally {
      setIsSavingDb(false);
    }
  };

  const resetStudentDatabase = async () => {
    if (!user || isSavingDb) return;
    if (!window.confirm("PERINGATAN: Ini akan memadam SEMUA data pelajar secara kekal. Pastikan anda mempunyai salinan sandaran fail .csv anda. Teruskan?")) return;
    
    const path = `artifacts/${appId}/public/data/student_database`;
    try {
      setIsSavingDb(true);
      showToast("Memadam semua data...");
      
      const q = query(collection(db, path));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        showToast("Pangkalan data sedia ada kosong.");
        setIsSavingDb(false);
        return;
      }
      
      const deleteBatches = [];
      let currentBatch = writeBatch(db);
      let count = 0;
      
      for (const d of snapshot.docs) {
        currentBatch.delete(d.ref);
        count++;
        if (count === 450) {
          deleteBatches.push(currentBatch.commit());
          currentBatch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) deleteBatches.push(currentBatch.commit());
      
      await Promise.all(deleteBatches);
      
      // Also clear local storage cache
      localStorage.removeItem('ubbm_student_db_cache');
      setStudentDb([]);
      
      showToast(`Berjaya memadam ${snapshot.docs.length} rekod. Sila muat naik fail yang betul.`);
    } catch (err) {
      console.error("Reset Error:", err);
      showToast("Gagal memadam data.");
    } finally {
      setIsSavingDb(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    console.log("File selected:", file.name, "Type:", file.type);
    const fileType = file.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();
    
    if (fileType === 'xlsx' || fileType === 'xls' || fileType === 'csv') {
      reader.onload = (evt) => {
        try {
          const wb = XLSX.read(evt.target?.result, { type: fileType === 'csv' ? 'string' : 'binary' });
          const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as any[][];
          console.log("Rows parsed from Excel/CSV:", data.length);
          const processed = data.slice(1).map(row => parseRow(row)).filter(p => p.nama);
          console.log("Students successfully processed:", processed.length);
          
          if (processed.length === 0) {
            alert("Tiada data pelajar sah ditemui. Sila semak format fail.");
            return;
          }
          
          setStudentDb(processed);
          saveStudentDbToFirestore(processed);
          showToast(`${processed.length} pelajar dimuat naik (Sedang menyelaraskan...)`);
        } catch (err) { 
          console.error("Excel/CSV Parse Error:", err);
          alert("Ralat memproses fail."); 
        }
      };
      if (fileType === 'csv') reader.readAsText(file);
      else reader.readAsBinaryString(file);
    } else if (fileType === 'pdf') {
      reader.onload = async (evt) => {
        try {
          const pdfData = new Uint8Array(evt.target?.result as ArrayBuffer);
          const pdf = await pdfjsLib.getDocument(pdfData).promise;
          let text = "";
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map((item: any) => item.str).join(" ") + "\n";
          }
          const processed = text.split("\n").map(line => parseRow(line.split(/\s{2,}/))).filter(p => p.nama);
          console.log("Students successfully processed from PDF:", processed.length);
          
          if (processed.length === 0) {
            alert("Tiada data pelajar ditemui dalam PDF. Pastikan fail mengandungi teks.");
            return;
          }
          
          setStudentDb(processed);
          saveStudentDbToFirestore(processed);
          showToast(`${processed.length} pelajar dimuat naik (Sedang menyelaraskan...)`);
        } catch (err) { 
          console.error("PDF Parsing Error:", err);
          alert("Ralat memproses fail PDF."); 
        }
      };
      reader.readAsArrayBuffer(file);
    }
    e.target.value = '';
  };

  useEffect(() => {
    const hasData = candidates.some(c => c.nama.trim() !== '');
    setIsPdfReady(hasData);
  }, [candidates]);

  useEffect(() => {
    const initAuth = async () => {
      try {
        // @ts-ignore
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          // @ts-ignore
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          // Silent anonymous sign in to ensure system works immediately
          if (!auth.currentUser) {
            await signInAnonymously(auth);
          }
        }
      } catch (error: any) {
        console.error("Silent Auth Error:", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currUser) => { 
      setUser(currUser); 
      setLoading(false); 
      if (currUser) {
        showToast("Sistem Sedia (Penyelarasan Awan Aktif)", "success");
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();

    const path = `artifacts/${appId}/public/data/ubbm_records`;
    const q = query(
      collection(db, path), 
      where("userId", "==", user.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      docs.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setRecords(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const path = `artifacts/${appId}/public/data/student_database`;
    // We removed the userId filter so all teachers can share the same student list
    const q = query(collection(db, path));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`Student DB Sync: Received ${snapshot.docs.length} students from Firestore`);
      
      // Client-side de-duplication to ensure UI is clean
      const uniqueMap = new Map();
      snapshot.docs.forEach(d => {
        const data = d.data();
        const key = data.noMaktab || d.id;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, { ...data, _docId: d.id });
        }
      });
      
      const remoteData = Array.from(uniqueMap.values());
      
      setStudentDb(remoteData);
      localStorage.setItem('ubbm_student_db_cache', JSON.stringify(remoteData));
      setLoadingStudentDb(false);
    }, (error) => {
      console.error("Student DB Sync Error:", error);
      setLoadingStudentDb(false);
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return () => unsubscribe();
  }, [user]);

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      showToast("Log masuk berjaya");
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        return; // Silent bypass for cancelled login
      }
      console.error("Login Error:", error);
      showToast("Gagal log masuk: " + (error.message || "Ralat tidak diketahui"));
    }
  };

  const handleLogout = async () => {
    setConfirmModal({
      show: true,
      title: "Log Keluar",
      message: "Adakah anda pasti untuk keluar dari sistem? Fungsi penyelarasan awan akan dihentikan sementara.",
      confirmText: "Log Keluar",
      variant: 'warning',
      onConfirm: async () => {
        try {
          showToast("Sedang log keluar dari akaun Google...", "info");
          await auth.signOut();
          setUser(null);
          showToast("Anda telah log keluar dengan selamat", "success");
          window.location.reload();
        } catch (error) {
          console.error("Logout Error:", error);
          showToast("Ralat teknikal semasa log keluar", "error");
        } finally {
          setConfirmModal(prev => ({ ...prev, show: false }));
        }
      }
    });
  };

  if (loading) return <div className="h-screen flex items-center justify-center font-bold text-blue-900 uppercase">MEMULAKAN SISTEM...</div>;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-800 relative">
      {/* Modal Pengesahan Global - Moved to top for visibility */}
      {confirmModal.show && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform animate-in zoom-in duration-200 border border-slate-200">
            <div className="p-8 text-center">
              <div className={`mx-auto w-20 h-20 rounded-full flex items-center justify-center mb-6 ${confirmModal.variant === 'danger' ? 'bg-red-100 text-red-600' : confirmModal.variant === 'warning' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                <Info size={40} />
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-3 uppercase tracking-wider">{confirmModal.title}</h3>
              <p className="text-slate-600 font-medium leading-relaxed mb-10 text-sm">{confirmModal.message}</p>
              
              <div className="flex gap-4">
                <button 
                  type="button"
                  onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
                  className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold transition-all active:scale-95 shadow-sm border border-slate-200"
                >
                  Batal
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    confirmModal.onConfirm();
                  }}
                  className={`flex-1 py-4 rounded-2xl font-bold transition-all active:scale-95 shadow-md ${
                    confirmModal.variant === 'danger' ? 'bg-red-600 hover:bg-red-700 text-white' : 
                    confirmModal.variant === 'warning' ? 'bg-orange-500 hover:bg-orange-600 text-white' : 
                    'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {confirmModal.confirmText}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls,.pdf,.csv" onChange={handleFileSelect} />
      
      {/* Modal Cari Calon */}
      {searchModal.show && (
        <div className="fixed inset-0 z-[500] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
                <div className="bg-blue-900 p-4 text-white flex justify-between items-center">
                    <h3 className="font-bold uppercase tracking-widest text-sm flex items-center gap-2"><Search size={18}/> Cari Calon (Baris {(searchModal.targetIdx || 0) + 1})</h3>
                    <button onClick={() => setSearchModal({show:false, targetIdx:null, term:''})}><X size={24}/></button>
                </div>
                <div className="p-4 border-b bg-slate-50 flex flex-col gap-3">
                    <div className="flex gap-2">
                        <div className="flex-grow">
                            <input 
                              autoFocus 
                              type="text" 
                              placeholder="Cari Nama / No Maktab / Homeroom..." 
                              className="w-full p-3 border-2 rounded-xl outline-none focus:border-blue-500 font-bold shadow-sm" 
                              value={searchModal.term} 
                              onChange={(e) => setSearchModal({...searchModal, term: e.target.value})} 
                            />
                        </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 items-center">
                        <div className="flex-grow flex gap-2">
                          {searchModal.tingkatan && (
                            <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-[10px] font-black border border-blue-200">
                              TINGKATAN {searchModal.tingkatan}
                            </div>
                          )}
                          {searchModal.kelas && (
                            <div className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-[10px] font-black border border-emerald-200">
                              KELAS {searchModal.kelas}
                            </div>
                          )}
                          {!searchModal.tingkatan && !searchModal.kelas && (
                            <div className="bg-slate-200 text-slate-500 px-3 py-1 rounded-full text-[10px] font-black border border-slate-300">
                              TIADA TAPISAN KELAS
                            </div>
                          )}
                        </div>

                        {searchModal.term && (
                          <button 
                            onClick={() => setSearchModal({...searchModal, term: ''})}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            title="Padam Carian"
                          >
                            <X size={20}/>
                          </button>
                        )}
                    </div>

                    <div className="flex justify-between items-center px-1 pt-1 border-t border-slate-200">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">
                        Padanan: {
                          [...studentDb].filter(s => {
                            const sTing = String(s.tingkatan || "").trim();
                            const sKelas = String(s.kelas || "").trim().toUpperCase();
                            const matchTing = !searchModal.tingkatan || sTing === String(searchModal.tingkatan).trim();
                            const matchKelas = !searchModal.kelas || sKelas === String(searchModal.kelas).trim().toUpperCase();
                            if (!matchTing || !matchKelas) return false;
                            
                            if (!searchModal.term || !searchModal.term.trim()) return true;
                            const term = searchModal.term.trim().toUpperCase();
                            return (String(s.nama || "").toUpperCase().includes(term)) || 
                                   (String(s.noMaktab || "").includes(term)) || 
                                   (String(s.homeroom || "").toUpperCase().includes(term)) ||
                                   (sKelas.includes(term));
                          }).length
                        } / {studentDb.length} Pelajar
                      </span>
                    </div>
                </div>
                <div className="flex-grow overflow-y-auto p-2">
                    {(() => {
                      const filtered = [...studentDb].sort((a, b) => {
                          const tingA = String(a.tingkatan || "");
                          const tingB = String(b.tingkatan || "");
                          if (tingA !== tingB) return tingA.localeCompare(tingB);
                          const kelasA = String(a.kelas || "").toUpperCase();
                          const kelasB = String(b.kelas || "").toUpperCase();
                          if (kelasA !== kelasB) return kelasA.localeCompare(kelasB);
                          const namaA = String(a.nama || "").toUpperCase();
                          const namaB = String(b.nama || "").toUpperCase();
                          return namaA.localeCompare(namaB);
                      }).filter(s => {
                          const sTing = String(s.tingkatan || "").trim();
                          const sKelas = String(s.kelas || "").trim().toUpperCase();
                          
                          const matchTing = !searchModal.tingkatan || sTing === String(searchModal.tingkatan).trim();
                          const matchKelas = !searchModal.kelas || sKelas === String(searchModal.kelas).trim().toUpperCase();
                          
                          // If filter is active but no match, we skip unless term is present? 
                          // Actually user wants it to be filtered if they chose it.
                          if (!matchTing || !matchKelas) return false;
                          
                          if (!searchModal.term || !searchModal.term.trim()) return true;
                          const term = searchModal.term.trim().toUpperCase();
                          return (String(s.nama || "").toUpperCase().includes(term)) || 
                                 (String(s.noMaktab || "").includes(term)) || 
                                 (String(s.homeroom || "").toUpperCase().includes(term)) ||
                                 (sKelas.includes(term));
                      });

                      return (
                        <>
                          <div className="flex flex-col gap-2 p-2 mb-2 bg-slate-100 rounded-lg">
                             <div className="flex justify-between items-center">
                               <div className="text-[10px] font-bold text-slate-500 uppercase">JUMLAH: {filtered.length} / {studentDb.length}</div>
                               {filtered.length > 0 && (searchModal.term || searchModal.tingkatan || searchModal.kelas) && (
                                 <button 
                                   type="button"
                                   onClick={(e) => {
                                     e.preventDefault();
                                     e.stopPropagation();
                                     if (confirmingDelete === 'bulk') {
                                       deleteFilteredStudents(filtered);
                                     } else {
                                       setConfirmingDelete('bulk');
                                     }
                                   }}
                                   disabled={isSavingDb}
                                   className={`text-[10px] font-black px-4 py-2 rounded-lg transition-all uppercase flex items-center gap-2 shadow-md border-none cursor-pointer ${isSavingDb ? 'bg-slate-400 cursor-not-allowed text-white' : (confirmingDelete === 'bulk' ? 'bg-red-800 text-white animate-pulse' : 'bg-red-600 hover:bg-red-700 text-white active:scale-95')}`}
                                 >
                                   <Trash2 size={16}/> {isSavingDb ? 'MEMADAM...' : (confirmingDelete === 'bulk' ? 'SAHKAN PADAM SEMUA?' : `Hapus ${filtered.length} Rekod`)}
                                 </button>
                               )}
                             </div>
                             {confirmingDelete === 'bulk' && !isSavingDb && (
                               <div className="flex justify-between items-center bg-red-50 p-2 rounded border border-red-200">
                                 <span className="text-[9px] font-bold text-red-700 uppercase">Hapus {filtered.length} rekod secara kekal?</span>
                                 <button onClick={() => setConfirmingDelete(null)} className="text-[9px] font-black text-slate-500 hover:underline">BATAL</button>
                               </div>
                             )}
                          </div>
                          {filtered.map((s, i) => {
                            const sid = s._docId || s.noMaktab;
                            const isConfirmingSelf = confirmingDelete === String(sid);
                            
                            return (
                              <div key={i} className={`p-3 border-b hover:bg-blue-50 cursor-pointer rounded-lg transition-all flex justify-between items-center group ${isConfirmingSelf ? 'bg-red-50 border-red-200' : ''}`}>
                                  <div onClick={() => selectStudent(s)} className="flex-grow text-left">
                                      <div className="font-black text-sm text-blue-900 uppercase">{s.nama}</div>
                                      <div className="text-[10px] text-slate-500 font-bold uppercase">NO.M: {s.noMaktab} | HR: {s.homeroom}</div>
                                      <div className="text-[9px] bg-blue-100 text-blue-700 w-fit px-2 mt-1 rounded font-black">{s.tingkatan} {s.kelas}</div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {isConfirmingSelf && !isSavingDb ? (
                                      <div className="flex items-center gap-2 pr-2 border-r border-red-200 mr-2">
                                        <button 
                                          onClick={(e) => { e.stopPropagation(); deleteStudentRecord(s); }}
                                          className="bg-red-600 text-white text-[9px] font-black px-3 py-1.5 rounded hover:bg-red-700 active:scale-95"
                                        >
                                          YA, PADAM
                                        </button>
                                        <button 
                                          onClick={(e) => { e.stopPropagation(); setConfirmingDelete(null); }}
                                          className="text-[9px] font-black text-slate-500 hover:underline"
                                        >
                                          BATAL
                                        </button>
                                      </div>
                                    ) : (
                                      <button 
                                        onClick={(e) => { 
                                          e.preventDefault();
                                          e.stopPropagation(); 
                                          setConfirmingDelete(String(sid)); 
                                        }}
                                        disabled={isSavingDb}
                                        className={`p-3 transition-all rounded-full border border-transparent ${isSavingDb ? 'text-slate-200 cursor-not-allowed' : 'text-slate-300 hover:text-red-500 hover:bg-red-50 hover:border-red-100 cursor-pointer active:scale-90'}`}
                                        title="Padam rekod ini"
                                      >
                                        <Trash2 size={20}/>
                                      </button>
                                    )}
                                  </div>
                              </div>
                            );
                          })}
                          {filtered.length === 0 && <div className="text-center py-10 text-slate-400">Pangkalan data kosong atau tiada padanan.</div>}
                        </>
                      );
                    })()}
                </div>
            </div>
        </div>
      )}

      {showManual && (
        <div className="fixed inset-0 z-[1100] bg-black/70 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in duration-300">
            <div className="bg-blue-900 p-6 text-white flex justify-between items-center bg-gradient-to-r from-blue-900 to-blue-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-500 rounded-lg text-blue-900">
                  <BookOpen size={24} />
                </div>
                <div>
                  <h3 className="font-black uppercase tracking-tighter text-xl">Manual Pengguna</h3>
                  <p className="text-[10px] font-bold text-blue-200">LANGKAH PENGGUNAAN SISTEM UBBM</p>
                </div>
              </div>
              <button 
                onClick={() => setShowManual(false)} 
                className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition-all"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="flex-grow overflow-y-auto p-8 space-y-8 bg-slate-50">
              {/* Step 0: Login */}
              <div className="flex gap-4 relative">
                <div className="flex-shrink-0 w-10 h-10 bg-yellow-100 text-yellow-700 rounded-full flex items-center justify-center font-black text-lg border-2 border-yellow-200 z-10">
                  <UserCheck size={20} />
                </div>
                <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-blue-100 -z-0"></div>
                <div className="space-y-2 pb-6">
                  <h4 className="font-black text-blue-900 uppercase text-sm tracking-wide">Log Masuk Sistem</h4>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    Guru perlu <span className="font-bold text-blue-700">Log Masuk menggunakan akaun Google</span> untuk mengaktifkan fungsi penyelarasan (Sync). Ini membolehkan data diakses dari mana-mana peranti.
                  </p>
                  <div className="bg-white p-3 rounded-xl border border-slate-200 flex items-start gap-3">
                    <ShieldCheck className="text-blue-500 shrink-0" size={16} />
                    <span className="text-[10px] text-slate-500">Ikon <span className="font-black text-blue-700">[LOG MASUK]</span> terletak di bahagian atas kanan skrin.</span>
                  </div>
                </div>
              </div>

              {/* Step 1 */}
              <div className="flex gap-4 relative">
                <div className="flex-shrink-0 w-10 h-10 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-black text-lg border-2 border-blue-200 z-10">1</div>
                <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-blue-100 -z-0"></div>
                <div className="space-y-2 pb-6">
                  <h4 className="font-black text-blue-900 uppercase text-sm tracking-wide">Penyediaan Database Pelajar</h4>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    Sistem memerlukan data pelajar untuk berfungsi. Anda boleh muat naik fail <span className="font-bold text-blue-700">Excel / PDF / CSV</span> yang mengandungi senarai pelajar.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4 relative">
                <div className="flex-shrink-0 w-10 h-10 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-black text-lg border-2 border-blue-200 z-10">2</div>
                <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-blue-100 -z-0"></div>
                <div className="space-y-2 pb-6">
                  <h4 className="font-black text-blue-900 uppercase text-sm tracking-wide">Pemilihan Calon Ujian</h4>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    Klik pada butang <Search size={14} className="inline"/> <span className="font-bold text-blue-700">Carian</span> pada kolum nama. Gunakan tapisan Tingkatan/Kelas yang telah ditetapkan secara automatik.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4 relative">
                <div className="flex-shrink-0 w-10 h-10 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-black text-lg border-2 border-blue-200 z-10">3</div>
                <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-blue-100 -z-0"></div>
                <div className="space-y-2 pb-6">
                  <h4 className="font-black text-blue-900 uppercase text-sm tracking-wide">Pemasukan Markah</h4>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    Masukkan markah bagi setiap kriteria. Markah <span className="font-bold text-blue-700">Individu</span> (Tatabahasa, Sebutan, Kefasihan, Idea) dan <span className="font-bold text-emerald-700">Holistik</span> (Grup).
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center font-black text-lg border-2 border-emerald-200 z-10">4</div>
                <div className="space-y-2">
                  <h4 className="font-black text-emerald-900 uppercase text-sm tracking-wide">Penyimpanan & Cetakan Data</h4>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    Klik <span className="font-bold text-blue-700">Simpan Rekod</span> untuk menghantar data ke <span className="font-bold text-blue-700">Cloud Database (Firestore)</span>. 
                  </p>
                  <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100 flex items-start gap-3 mt-2">
                    <History className="text-emerald-500 shrink-0" size={16} />
                    <span className="text-[10px] text-emerald-700 font-bold leading-tight">
                      Data yang disimpan selamat di awan & boleh dilihat semula melalui menu [SEJARAH].
                    </span>
                  </div>
                </div>
              </div>

            </div>

            <div className="p-4 bg-slate-100 text-center border-t border-slate-200">
               <button 
                 onClick={() => setShowManual(false)}
                 className="bg-blue-900 text-white font-black px-10 py-3 rounded-2xl hover:bg-blue-800 transition-all active:scale-95 shadow-lg uppercase text-xs"
               >
                 Faham, Tutup Manual
               </button>
            </div>
          </div>
        </div>
      )}

      {notification.show && (
        <div 
          className={`fixed bottom-10 left-1/2 -translate-x-1/2 z-[1000] text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border-2 transition-all duration-300 transform translate-y-0 opacity-100 ${
            notification.type === 'success' ? 'bg-emerald-600 border-emerald-400' : 
            notification.type === 'error' ? 'bg-red-600 border-red-400' : 
            'bg-blue-600 border-blue-400'
          }`}
        >
             {notification.type === 'success' ? <CheckCircle2 size={24} /> : notification.type === 'error' ? <X size={24} /> : <FileText size={24} />}
             <span className="font-black uppercase tracking-widest text-sm">{String(notification.message)}</span>
        </div>
      )}

      <div className="flex-grow p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-blue-900 p-6 text-white text-center border-b-4 border-yellow-500 relative">
              <h1 className="text-2xl font-black uppercase tracking-widest">Maktab Rendah Sains Mara</h1>
              <h2 className="text-lg font-bold mt-1 italic underline underline-offset-8">Borang Markah Ujian Bertutur Bahasa Melayu (UBBM)</h2>
              <div className="absolute top-2 right-2 flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isSavingDb || loadingStudentDb ? 'bg-yellow-400 animate-pulse' : (studentDb.length > 0 ? 'bg-emerald-400' : 'bg-red-400')}`}></div>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-blue-200">
                      {isSavingDb ? 'MENYIMPAN...' : (loadingStudentDb ? 'MENYEMAK...' : (studentDb.length > 0 ? `${studentDb.length} PELAJAR` : 'TIADA DATABASE'))}
                    </span>
                   {studentDb.length > 0 && !loadingStudentDb && (
                     <div className="flex gap-1 ml-1">
                       <button 
                          onClick={cleanupRedundantData}
                          className="p-1 bg-white/5 hover:bg-red-500/20 text-[8px] text-white/30 hover:text-red-300 border border-white/10 rounded transition-all italic"
                          title="Klik untuk buang data pendua dari pangkalan data"
                       >
                          [BERSIH PENDUA]
                       </button>
                       <button 
                          onClick={resetStudentDatabase}
                          className="p-1 bg-white/5 hover:bg-red-500/20 text-[8px] text-white/30 hover:text-red-500 border border-white/10 rounded transition-all italic"
                          title="PADAM SEMUA: Gunakan ini jika anda tersalah muat naik fail"
                       >
                          [SET SEMULA DATA]
                       </button>
                     </div>
                   )}
                </div>
                {user && (
                  <div className="flex flex-col items-end gap-1">
                    {user.isAnonymous ? (
                      <button 
                        onClick={handleGoogleLogin}
                        className="text-[9px] font-black bg-amber-500 hover:bg-amber-600 text-white px-2 py-1 rounded shadow-sm transition-all flex items-center gap-1 uppercase animate-bounce"
                      >
                        <Upload size={10} /> Aktifkan Penyelarasan (Sync)
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 bg-emerald-900/40 px-3 py-1.5 rounded-full border border-emerald-400/30 shadow-inner">
                        <span className="text-[10px] text-emerald-300 font-black uppercase truncate max-w-[150px] tracking-tight">
                          {user.email || 'Guru Aktif'}
                        </span>
                        <button 
                          onClick={handleLogout}
                          className="bg-red-500/30 hover:bg-red-600 text-white p-1.5 rounded-full transition-all active:scale-90 shadow-md border border-red-400/50"
                          title="Log Keluar"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                    <div className="flex gap-1.5 mt-1">
                      <button 
                        onClick={() => setShowManual(true)}
                        className="bg-yellow-500 hover:bg-yellow-400 text-blue-900 p-1.5 rounded-full shadow-md transition-all hover:rotate-12 border border-yellow-300 active:scale-90"
                        title="Buka Manual Pengguna"
                      >
                        <BookOpen size={12} />
                      </button>
                      <button 
                        onClick={() => document.getElementById('arkib-section')?.scrollIntoView({ behavior: 'smooth' })}
                        className="bg-indigo-500 hover:bg-indigo-400 text-white p-1.5 rounded-full shadow-md transition-all hover:-rotate-12 border border-indigo-300 active:scale-90"
                        title="Lompat ke Arkib Rekod"
                      >
                        <History size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            <div className="p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 bg-slate-50 p-6 rounded-xl border-2 border-slate-200 items-end text-left">
                <div className="space-y-2">
                  <label className="text-xs font-black text-blue-900 uppercase">Jenis Ujian</label>
                  <select value={header.jenisUjian} onChange={(e) => setHeader({...header, jenisUjian: e.target.value})} className="w-full p-2.5 border-2 rounded-lg font-bold outline-none focus:border-blue-500 text-sm">
                    {JENIS_UJIAN_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-blue-900 uppercase">Sidang</label>
                  <select value={header.sidang} onChange={(e) => setHeader({...header, sidang: e.target.value})} className="w-fit p-2.5 border-2 rounded-lg font-bold min-w-[80px] text-sm">
                    {[1,2,3,4,5].map(n => <option key={n} value={String(n)}>{n}</option>)}
                  </select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <div className="flex flex-col items-center">
                    <label className="text-xs font-black text-blue-900 uppercase mb-2">Tarikh / Masa</label>
                    <input type="text" value={header.tarikhMasa} onChange={(e) => setHeader({...header, tarikhMasa: e.target.value})} className="w-3/4 p-2.5 border-2 rounded-lg font-bold text-center outline-none" />
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto shadow-sm rounded-lg border border-slate-400 text-center">
                <table className="w-full border-collapse min-w-[1100px] text-sm">
                  <thead>
                    <tr className="bg-blue-950 text-white text-[11px] font-black uppercase tracking-wider">
                      <th className="border border-blue-800 p-4 w-12" rowSpan={2}>Bil</th>
                      <th className="border border-blue-800 p-4 text-left" rowSpan={2}>
                        <div className="flex items-center justify-between">
                          <span>Calon (Nama / Homeroom / No. Maktab)</span>
                          <div className="flex gap-2">
                             <button onClick={() => fileInputRef.current?.click()} className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md flex items-center gap-1 transition-all"><Upload size={14}/> MUAT NAIK FAIL</button>
                          </div>
                        </div>
                      </th>
                      <th className="border border-blue-800 p-4 w-32" rowSpan={2}>Ting / Kelas</th>
                      <th className="border border-blue-800 p-4 bg-blue-900" colSpan={5}>A. INDIVIDU (ANALITIK) [40m]</th>
                      <th className="border border-blue-800 p-4 bg-emerald-800" rowSpan={2}>B. KUMP [30m]</th>
                      <th className="border border-blue-800 p-4 bg-yellow-600" rowSpan={2}>JUMLAH (70m)</th>
                    </tr>
                    <tr className="bg-slate-300 text-[10px] font-black text-slate-800 uppercase">
                      <th className="border border-slate-400 p-2 w-16">Tata</th><th className="border border-slate-400 p-2 w-16">Sebut</th><th className="border border-slate-400 p-2 w-16">Fasih</th><th className="border border-slate-400 p-2 w-16">Idea</th><th className="border border-slate-400 p-2 w-16 bg-blue-100">JUM A</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {candidates.map((c, idx) => (
                      <tr key={idx} className="hover:bg-blue-50/50 transition-all border-b border-slate-200">
                        <td className="border-x border-slate-300 p-3 font-black text-slate-500">{idx + 1}</td>
                        <td className="border-x border-slate-300 p-3 text-left space-y-2">
                          <div className="flex gap-2 items-center">
                            <input 
                                placeholder="NAMA PENUH" 
                                className="flex-grow text-sm font-black p-1 border-b uppercase outline-none focus:border-blue-500 bg-transparent" 
                                value={c.nama} 
                                onChange={(e) => { 
                                  const n = [...candidates]; 
                                  n[idx] = { ...n[idx], nama: e.target.value.toUpperCase() }; 
                                  setCandidates(n); 
                                }} 
                              />
                            <button type="button" onClick={(e) => { e.preventDefault(); openSearch(idx, c.tingkatan, c.kelas); }} className="text-blue-600 hover:bg-blue-100 p-2 rounded-lg relative transition-all active:scale-95 shadow-sm border border-blue-50">
                              <Search size={20}/>
                              {studentDb.length > 0 && <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white shadow-sm"></div>}
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <input 
                              placeholder="HR (A-N)" 
                              className="w-1/2 text-[11px] p-1.5 border rounded bg-slate-50 font-bold" 
                              value={c.homeroom} 
                              onChange={(e) => { 
                                const n = [...candidates]; 
                                n[idx] = { ...n[idx], homeroom: e.target.value.toUpperCase().slice(0,1) }; 
                                setCandidates(n); 
                              }} 
                            />
                            <input 
                              placeholder="NO. MAKTAB" 
                              className="w-1/2 text-[11px] p-1.5 border rounded bg-slate-50" 
                              value={c.noMaktab} 
                              onChange={(e) => { 
                                const n = [...candidates]; 
                                n[idx] = { ...n[idx], noMaktab: e.target.value }; 
                                setCandidates(n); 
                              }} 
                            />
                          </div>
                        </td>
                        <td className="border-x border-slate-300 p-2">
                            <div className="space-y-1">
                                <select 
                                  className="w-full p-1 border rounded font-bold text-[10px] cursor-pointer hover:bg-blue-50" 
                                  value={c.tingkatan} 
                                  onChange={(e) => { 
                                    const val = e.target.value;
                                    const n = [...candidates]; 
                                    n[idx] = { ...n[idx], tingkatan: val }; 
                                    setCandidates(n); 
                                    if(studentDb.length > 0) openSearch(idx, val, c.kelas);
                                  }}
                                >
                                  {TINGKATAN_OPTIONS.map(opt => <option key={opt} value={opt}>TING {opt}</option>)}
                                </select>
                                <select 
                                  className="w-full p-1 border rounded font-bold text-[10px] cursor-pointer hover:bg-blue-50" 
                                  value={c.kelas} 
                                  onChange={(e) => { 
                                    const val = e.target.value;
                                    const n = [...candidates]; 
                                    n[idx] = { ...n[idx], kelas: val }; 
                                    setCandidates(n); 
                                    if(studentDb.length > 0) openSearch(idx, c.tingkatan, val);
                                  }}
                                >
                                  {KELAS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                </select>
                            </div>
                        </td>
                        <td className="border-x border-slate-300 p-1"><input type="number" className="w-full text-center p-2 font-black text-blue-800 text-lg outline-none bg-transparent" value={c.analitik.tatabahasa} onChange={(e) => handleAnalitikChange(idx, 'tatabahasa', e.target.value)} /></td>
                        <td className="border-x border-slate-300 p-1"><input type="number" className="w-full text-center p-2 font-black text-blue-800 text-lg outline-none bg-transparent" value={c.analitik.sebutan} onChange={(e) => handleAnalitikChange(idx, 'sebutan', e.target.value)} /></td>
                        <td className="border-x border-slate-300 p-1"><input type="number" className="w-full text-center p-2 font-black text-blue-800 text-lg outline-none bg-transparent" value={c.analitik.kefasihan} onChange={(e) => handleAnalitikChange(idx, 'kefasihan', e.target.value)} /></td>
                        <td className="border-x border-slate-300 p-1"><input type="number" className="w-full text-center p-2 font-black text-blue-800 text-lg outline-none bg-transparent" value={c.analitik.idea} onChange={(e) => handleAnalitikChange(idx, 'idea', e.target.value)} /></td>
                        <td className="border-x border-slate-300 p-1 bg-blue-100 font-black text-blue-900 text-lg">{calculateAnalitikTotal(c)}</td>
                        <td className="border-x border-slate-300 p-1 bg-emerald-50"><input type="number" className="w-full text-center p-2 font-black text-emerald-800 text-lg outline-none bg-transparent" value={c.holistik} onChange={(e) => handleHolistikChange(idx, e.target.value)} /></td>
                        <td className="border-x border-slate-300 p-1 bg-yellow-200 font-black text-2xl text-blue-950">{calculateAnalitikTotal(c) + (Number(c.holistik) || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="pt-8 border-t-2 grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
                  <div className="p-5 bg-white rounded-2xl border-2 space-y-4 shadow-sm">
                    <div className="flex items-center gap-2 text-blue-800 font-black text-xs uppercase"><PenTool size={16}/> Guru Pemeriksa</div>
                    <input type="text" value={header.pemeriksaNama} onChange={(e) => setHeader({...header, pemeriksaNama: e.target.value})} className="w-full p-2.5 text-xs border-2 rounded-lg font-bold" placeholder="Nama" />
                    <input type="text" value={header.pemeriksaJawatan} onChange={(e) => setHeader({...header, pemeriksaJawatan: e.target.value})} className="w-full p-2.5 text-xs border-2 rounded-lg font-bold" />
                  </div>
                  <div className="p-5 bg-white rounded-2xl border-2 space-y-4 shadow-sm">
                    <div className="flex items-center gap-2 text-blue-800 font-black text-xs uppercase"><ShieldCheck size={16}/> Penyemak Markah</div>
                    <input type="text" value={header.penyemakNama} onChange={(e) => setHeader({...header, penyemakNama: e.target.value})} className="w-full p-2.5 text-xs border-2 rounded-lg font-bold" placeholder="Nama" />
                    <input type="text" value={header.tarikhSemak} onChange={(e) => setHeader({...header, tarikhSemak: e.target.value})} className="w-full p-2.5 text-xs border-2 rounded-lg font-bold" />
                  </div>
                  <div className="p-5 bg-white rounded-2xl border-2 space-y-4 shadow-sm">
                    <div className="flex items-center gap-2 text-blue-800 font-black text-xs uppercase"><UserCheck size={16}/> Pengesah Markah</div>
                    <input type="text" value={header.pengesahNama} onChange={(e) => setHeader({...header, pengesahNama: e.target.value})} className="w-full p-2.5 text-xs border-2 rounded-lg font-bold" placeholder="Nama" />
                    <input type="text" value={header.tarikhSah} onChange={(e) => setHeader({...header, tarikhSah: e.target.value})} className="w-full p-2.5 text-xs border-2 rounded-lg font-bold" />
                  </div>
              </div>
              <div className="flex flex-wrap gap-4 pt-8 border-t-2 justify-center">
                <button 
                  onClick={saveRecord} 
                  disabled={isSavingRecord}
                  className="flex items-center gap-3 px-8 py-3 bg-blue-700 text-white rounded-xl hover:bg-blue-800 font-black uppercase active:scale-95 transition-all shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save size={20}/> {isSavingRecord ? 'Menyimpan...' : 'Simpan Rekod'}
                </button>
                <button 
                  onClick={generatePDF} 
                  disabled={!isPdfReady || isGeneratingPdf} 
                  className="flex items-center gap-3 px-8 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-black uppercase active:scale-95 transition-all shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Printer size={20}/> {isGeneratingPdf ? 'Menjana...' : 'Cetak PDF'}
                </button>
                <button 
                  onClick={generateIndukPDF} 
                  disabled={!isPdfReady || isGeneratingPdf} 
                  className="flex items-center gap-3 px-8 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-black uppercase active:scale-95 transition-all shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ListChecks size={20}/> Jana Markah Induk
                </button>
                <button 
                  type="button"
                  onClick={resetForm} 
                  disabled={isSavingRecord || isGeneratingPdf || isSavingDb}
                  className="px-8 py-3 bg-red-50 text-red-700 border-2 border-red-100 rounded-xl font-black uppercase hover:bg-red-600 hover:text-white active:scale-95 transition-all disabled:opacity-50 shadow-sm"
                >
                  Reset Borang
                </button>
              </div>
            </div>
          </div>
          
          <div id="arkib-section" className="bg-white rounded-2xl shadow-2xl border-2 border-slate-200 overflow-hidden text-left">
            <div className="bg-slate-900 p-6 text-white flex justify-between items-center border-b-4 border-blue-600">
               <div className="flex items-center gap-4"><History size={24} className="text-yellow-500" /><h3 className="font-black uppercase tracking-[0.2em] text-lg">Arkib Senarai Simpanan Rekod</h3></div>
               <span className="bg-blue-600 px-6 py-2 rounded-full text-xs font-black">{records.length} REKOD</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-[10px] text-slate-500 uppercase font-black bg-slate-50 border-b">
                  <tr><th className="px-6 py-4">Tarikh / Masa Simpan</th><th className="px-6 py-4">Pemeriksa</th><th className="px-6 py-4 text-center">Tindakan</th></tr>
                </thead>
                <tbody className="divide-y">
                  {records.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-10 text-center text-slate-400 font-bold uppercase tracking-widest">
                        Tiada rekod tersimpan
                      </td>
                    </tr>
                  ) : (
                    records.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50/50 group transition-all">
                        <td className="px-6 py-4"><div className="font-black text-blue-700">{String(rec.header?.tarikhSimpan || "")}</div><div className="text-[10px] text-slate-400 font-bold">{String(rec.header?.masaSimpan || "")}</div></td>
                        <td className="px-6 py-4 font-bold text-slate-800 uppercase text-xs">{String(rec.header?.pemeriksaNama || '---')}</td>
                        <td className="px-6 py-4 flex items-center justify-center gap-2">
                          <button 
                            onClick={() => loadRecord(rec)} 
                            title="Papar Semula"
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-600 hover:text-white transition-all text-[10px] font-black uppercase"
                          >
                            <Eye size={14}/> PAPAR SEMULA
                          </button>
                          <button 
                            onClick={() => deleteRecord(rec.id)} 
                            title="Padam Rekod"
                            className="p-1.5 bg-red-50 text-red-400 rounded-md hover:bg-red-500 hover:text-white transition-all"
                          >
                            <Trash2 size={14}/>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <footer className="bg-white border-t-2 py-10 text-center"><p className="text-slate-400 text-xs font-black uppercase tracking-[0.4em]">Sistem dibangunkan oleh Cikgu Wan Bee 2026</p></footer>
    </div>
  );
};

export default App;
