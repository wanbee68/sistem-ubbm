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
  UserCheck, ShieldCheck, Search,
  PenTool, CheckCircle2, ListChecks, Upload, X
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
  const [isPdfReady, setIsPdfReady] = useState(false);
  const [notification, setNotification] = useState({ show: false, message: '' });
  const [searchModal, setSearchModal] = useState<{show: boolean, targetIdx: number | null, term: string}>({ show: false, targetIdx: null, term: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Form State
  const [header, setHeader] = useState({
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
  });

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

  const [candidates, setCandidates] = useState<Candidate[]>(Array(5).fill(null).map(emptyCandidate));

  // --- LOGIK KEMASUKAN MARKAH ---

  const handleAnalitikChange = (idx: number, field: keyof Candidate['analitik'], val: string) => {
    if (val === '') {
      const newCandidates = [...candidates];
      newCandidates[idx].analitik[field] = '';
      setCandidates(newCandidates);
      return;
    }
    let num = parseInt(val);
    if (isNaN(num)) return;
    num = Math.max(0, Math.min(10, num));
    const newCandidates = [...candidates];
    newCandidates[idx].analitik[field] = num;
    setCandidates(newCandidates);
  };

  const handleHolistikChange = (idx: number, val: string) => {
    if (val === '') {
      const newCandidates = [...candidates];
      newCandidates[idx].holistik = '';
      setCandidates(newCandidates);
      return;
    }
    let num = parseInt(val);
    if (isNaN(num)) return;
    num = Math.max(0, Math.min(30, num));
    const newCandidates = [...candidates];
    newCandidates[idx].holistik = num;
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

  const showToast = (msg: string) => {
    setNotification({ show: true, message: String(msg) });
    setTimeout(() => setNotification({ show: false, message: '' }), 4000);
  };

  const resetForm = () => {
    if (!window.confirm("Kosongkan borang sekarang?")) return;
    setCandidates(Array(5).fill(null).map(emptyCandidate));
    setHeader(prev => ({ ...prev, jenisUjian: JENIS_UJIAN_OPTIONS[0], tarikhMasa: '' }));
    showToast("Borang telah dikosongkan");
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

  const openSearch = (idx: number) => {
    console.log("Search button clicked for index:", idx);
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
    setSearchModal({ show: true, targetIdx: idx, term: '' });
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
      showToast("Sedang mengemaskini pangkalan data... Sila tunggu.");
      
      // Update local storage first for speed
      localStorage.setItem('ubbm_student_db_cache', JSON.stringify(students));
      
      // 1. Delete old docs for this user (chunked)
      const q = query(collection(db, path), where("userId", "==", user.uid));
      const oldDocs = await getDocs(q);
      
      const deleteBatches = [];
      let currentDeleteBatch = writeBatch(db);
      let opCount = 0;
      
      oldDocs.forEach(d => {
        currentDeleteBatch.delete(d.ref);
        opCount++;
        if (opCount === 450) {
          deleteBatches.push(currentDeleteBatch.commit());
          currentDeleteBatch = writeBatch(db);
          opCount = 0;
        }
      });
      if (opCount > 0) deleteBatches.push(currentDeleteBatch.commit());
      await Promise.all(deleteBatches);

      // 2. Add new docs in chunks
      const addBatches = [];
      let currentAddBatch = writeBatch(db);
      opCount = 0;

      students.forEach(s => {
        const newDocRef = doc(collection(db, path));
        currentAddBatch.set(newDocRef, { ...s, userId: user.uid, updatedAt: new Date().toISOString() });
        opCount++;
        if (opCount === 450) {
          addBatches.push(currentAddBatch.commit());
          currentAddBatch = writeBatch(db);
          opCount = 0;
        }
      });
      if (opCount > 0) addBatches.push(currentAddBatch.commit());
      
      await Promise.all(addBatches);
      setIsSavingDb(false);
      showToast(`Pangkalan data (${students.length} pelajar) telah disimpan dengan selamat.`);
    } catch (err) {
      setIsSavingDb(false);
      console.error("Save Student DB Error:", err);
      alert("Gagal menyimpan ke awan. Data hanya tersedia secara luar talian buat masa ini.");
      handleFirestoreError(err, OperationType.WRITE, path);
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
          showToast(`${processed.length} pelajar dimuat naik`);
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
          showToast(`${processed.length} pelajar dimuat naik`);
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
    setIsPdfReady(true);
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        // @ts-ignore
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          // @ts-ignore
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          // Only sign in anonymously if there's no existing session
          if (!auth.currentUser) {
            await signInAnonymously(auth);
          }
        }
      } catch (error: any) {
        console.error("Auth error:", error);
        if (error.code === 'auth/admin-restricted-operation') {
          console.warn("Anonymous auth disabled. Please use Google Login.");
        }
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currUser) => { 
      setUser(currUser); 
      setLoading(false); 
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
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setRecords(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const path = `artifacts/${appId}/public/data/student_database`;
    const q = query(collection(db, path), where("userId", "==", user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`Student DB Sync: Received ${snapshot.docs.length} students from Firestore`);
      const remoteData = snapshot.docs.map(doc => doc.data());
      
      if (snapshot.docs.length > 0) {
        setStudentDb(remoteData);
        localStorage.setItem('ubbm_student_db_cache', JSON.stringify(remoteData));
      }
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
      await signInWithPopup(auth, provider);
      showToast("Log masuk berjaya");
    } catch (error) {
      console.error("Login Error:", error);
      alert("Gagal log masuk dengan Google.");
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center font-bold text-blue-900 uppercase">MEMULAKAN SISTEM...</div>;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-800">
      {!user && (
        <div className="fixed inset-0 z-[300] bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
          <div className="bg-white p-10 rounded-3xl shadow-2xl border-2 border-blue-100 max-w-md w-full space-y-6">
            <div className="w-20 h-20 bg-blue-900 rounded-2xl mx-auto flex items-center justify-center text-white shadow-xl">
              <ShieldCheck size={40} />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-blue-900 uppercase tracking-tight">Sila Log Masuk</h2>
              <p className="text-slate-500 font-medium">Akses sistem memerlukan pengesahan identiti untuk keselamatan data.</p>
            </div>
            <button 
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-3 py-4 bg-blue-700 hover:bg-blue-800 text-white rounded-2xl font-black uppercase transition-all active:scale-95 shadow-lg"
            >
              Log Masuk Dengan Google
            </button>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Sistem Markah UBBM © 2026</p>
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
                <div className="p-4 border-b bg-slate-50 flex flex-col gap-2">
                    <input autoFocus type="text" placeholder="Masukkan Nama, Homeroom (A-N) atau No Maktab..." className="w-full p-3 border-2 rounded-xl outline-none focus:border-blue-500 font-bold" value={searchModal.term} onChange={(e) => setSearchModal({...searchModal, term: e.target.value})} />
                    <div className="flex justify-between items-center px-1">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">
                        Hasil Carian: {
                          [...studentDb].filter(s => {
                            if (!searchModal.term) return true;
                            const term = searchModal.term.toUpperCase();
                            return (String(s.nama).includes(term)) || 
                                   (String(s.noMaktab).includes(term)) || 
                                   (String(s.homeroom).includes(term)) ||
                                   (String(s.kelas).toUpperCase().includes(term));
                          }).length
                        } / {studentDb.length} Pelajar
                      </span>
                    </div>
                </div>
                <div className="flex-grow overflow-y-auto p-2">
                    {[...studentDb].sort((a, b) => {
                        // 1. Sort by Tingkatan (Tingkatan 4 before Tingkatan 5)
                        const tingA = String(a.tingkatan || "");
                        const tingB = String(b.tingkatan || "");
                        if (tingA !== tingB) return tingA.localeCompare(tingB);
                        
                        // 2. Sort by Kelas (Alphabetical)
                        const kelasA = String(a.kelas || "").toUpperCase();
                        const kelasB = String(b.kelas || "").toUpperCase();
                        if (kelasA !== kelasB) return kelasA.localeCompare(kelasB);
                        
                        // 3. Sort by Nama (Alphabetical)
                        const namaA = String(a.nama || "").toUpperCase();
                        const namaB = String(b.nama || "").toUpperCase();
                        return namaA.localeCompare(namaB);
                    }).filter(s => {
                        if (!searchModal.term) return true;
                        const term = searchModal.term.toUpperCase();
                        return (String(s.nama).includes(term)) || 
                               (String(s.noMaktab).includes(term)) || 
                               (String(s.homeroom).includes(term)) ||
                               (String(s.kelas).toUpperCase().includes(term));
                    }).map((s, i) => (
                        <div key={i} onClick={() => selectStudent(s)} className="p-3 border-b hover:bg-blue-50 cursor-pointer rounded-lg transition-all flex justify-between items-center text-left">
                            <div>
                                <div className="font-black text-sm text-blue-900">{s.nama}</div>
                                <div className="text-[10px] text-slate-500 font-bold uppercase">NO.M: {s.noMaktab} | HR: {s.homeroom}</div>
                            </div>
                            <div className="text-[10px] bg-blue-100 text-blue-700 px-2 py-1 rounded font-black">{s.tingkatan} {s.kelas}</div>
                        </div>
                    ))}
                    {studentDb.length === 0 && <div className="text-center py-10 text-slate-400">Pangkalan data kosong. Sila muat naik fail Excel dahulu.</div>}
                </div>
            </div>
        </div>
      )}

      {notification.show && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[1000] bg-emerald-600 text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border-2 border-emerald-400 animate-bounce">
             <CheckCircle2 size={24} /> <span className="font-black uppercase tracking-widest text-sm">{String(notification.message)}</span>
        </div>
      )}

      <div className="flex-grow p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-blue-900 p-6 text-white text-center border-b-4 border-yellow-500 relative">
              <h1 className="text-2xl font-black uppercase tracking-widest">Maktab Rendah Sains Mara</h1>
              <h2 className="text-lg font-bold mt-1 italic underline underline-offset-8">Borang Markah Ujian Bertutur Bahasa Melayu (UBBM)</h2>
              <div className="absolute top-2 right-2 flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${isSavingDb || loadingStudentDb ? 'bg-yellow-400 animate-pulse' : (studentDb.length > 0 ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-red-400')}`}></div>
                <span className="text-[10px] font-black uppercase tracking-tighter text-blue-100">
                  {isSavingDb ? 'Saving...' : (loadingStudentDb ? 'Syncing...' : (studentDb.length > 0 ? `${studentDb.length} Pelajar` : 'No DB'))}
                </span>
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
                            <input placeholder="NAMA PENUH" className="flex-grow text-sm font-black p-1 border-b uppercase outline-none focus:border-blue-500 bg-transparent" value={c.nama} onChange={(e) => { const n = [...candidates]; n[idx].nama = e.target.value.toUpperCase(); setCandidates(n); }} />
                            <button type="button" onClick={(e) => { e.preventDefault(); openSearch(idx); }} className="text-blue-600 hover:bg-blue-100 p-2 rounded-lg relative transition-all active:scale-95 shadow-sm border border-blue-50">
                              <Search size={20}/>
                              {studentDb.length > 0 && <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white shadow-sm"></div>}
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <input placeholder="HR (A-N)" className="w-1/2 text-[11px] p-1.5 border rounded bg-slate-50 font-bold" value={c.homeroom} onChange={(e) => { const n = [...candidates]; n[idx].homeroom = e.target.value.toUpperCase().slice(0,1); setCandidates(n); }} />
                            <input placeholder="NO. MAKTAB" className="w-1/2 text-[11px] p-1.5 border rounded bg-slate-50" value={c.noMaktab} onChange={(e) => { const n = [...candidates]; n[idx].noMaktab = e.target.value; setCandidates(n); }} />
                          </div>
                        </td>
                        <td className="border-x border-slate-300 p-2 space-y-2">
                            <select className="w-full p-1.5 border rounded font-bold text-xs" value={c.tingkatan} onChange={(e) => { const n = [...candidates]; n[idx].tingkatan = e.target.value; setCandidates(n); }}>{TINGKATAN_OPTIONS.map(opt => <option key={opt} value={opt}>TING {opt}</option>)}</select>
                            <select className="w-full p-1.5 border rounded font-bold text-xs" value={c.kelas} onChange={(e) => { const n = [...candidates]; n[idx].kelas = e.target.value; setCandidates(n); }}>{KELAS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}</select>
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
                  onClick={resetForm} 
                  disabled={isSavingRecord || isGeneratingPdf || isSavingDb}
                  className="px-8 py-3 bg-slate-200 text-slate-700 rounded-xl font-black uppercase hover:bg-slate-300 active:scale-95 transition-all disabled:opacity-50"
                >
                  Reset Borang
                </button>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-2xl shadow-2xl border-2 border-slate-200 overflow-hidden text-left">
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
                  {records.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50/50 group transition-all">
                      <td className="px-6 py-4"><div className="font-black text-blue-700">{String(rec.header?.tarikhSimpan || "")}</div><div className="text-[10px] text-slate-400 font-bold">{String(rec.header?.masaSimpan || "")}</div></td>
                      <td className="px-6 py-4 font-bold text-slate-800 uppercase text-xs">{String(rec.header?.pemeriksaNama || '---')}</td>
                      <td className="px-6 py-4 flex items-center justify-center gap-3">
                        <button onClick={() => loadRecord(rec)} className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all"><FileText size={18}/></button>
                        <button onClick={() => deleteRecord(rec.id)} className="p-2 bg-red-50 text-red-400 rounded-lg hover:bg-red-500 hover:text-white transition-all"><Trash2 size={18}/></button>
                      </td>
                    </tr>
                  ))}
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
