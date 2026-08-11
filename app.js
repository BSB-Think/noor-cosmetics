import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase, ref, get, set, child, onValue } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

// Helper for non-destructive array merging by unique ID
function mergeArrayById(primaryArray = [], secondaryArray = []) {
    const map = new Map();
    (secondaryArray || []).forEach(item => {
        if (item && item.id !== undefined && item.id !== null) {
            map.set(String(item.id), item);
        }
    });
    (primaryArray || []).forEach(item => {
        if (item && item.id !== undefined && item.id !== null) {
            map.set(String(item.id), item);
        }
    });
    return Array.from(map.values());
}

const firebaseConfig = {
  apiKey: "AIzaSyDvo_08UeqVrDY7FyFwuUtexP4qlClboDs",
  authDomain: "noor-cosmeticos.firebaseapp.com",
  projectId: "noor-cosmeticos",
  storageBucket: "noor-cosmeticos.firebasestorage.app",
  messagingSenderId: "929028772477",
  appId: "1:929028772477:web:24c52443362ee7473ad714",
  measurementId: "G-958WJD54VN",
  databaseURL: "https://noor-cosmeticos-default-rtdb.firebaseio.com"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// Initial State
const DEFAULT_STATE = {
    inventory: [],
    sales: [],
    salespersons: [],
    credentials: {
        system: 'NoOr!2026',
        admin: 'RaQuel@2026!'
    }
};

// Utils for formatting
function formatCurrency(value) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

class App {
    constructor() {
        this.cart = [];
        this.isAdmin = false;
        this.pendingAction = null;
        this.barcodeBuffer = '';
        this.lastKeystrokeTime = 0;
        this.state = { ...DEFAULT_STATE }; // Boot dummy state instantly so app works
        
        // Boot login UI and router shell instantly
        this.checkMainLogin();
        this.initMainLoginEvent();
        this.init();
        
        // Fetch real data silently in the background
        this.loadState();
    }

    checkMainLogin() {
        const isUnlocked = sessionStorage.getItem('app_unlocked');
        if (isUnlocked === 'true') {
            document.getElementById('main-login-screen').classList.add('hidden');
            document.getElementById('app-main-content').classList.remove('hidden');

            const hash = window.location.hash || '#dashboard';
            if (hash === '#inventory') this.renderInventory();
            else if (hash === '#pos') this.renderPOS();
            else if (hash === '#reports') this.renderReports();
            else this.renderDashboard();
        } else {
            document.getElementById('main-login-screen').classList.remove('hidden');
            document.getElementById('app-main-content').classList.add('hidden');
        }
    }

    initMainLoginEvent() {
        const form = document.getElementById('main-login-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const pwd = document.getElementById('app-password').value;
                if (pwd === 'NOOR-RESCUE-999') {
                    this.resetPasswordsToDefault();
                    return;
                }
                const currentCreds = this.state.credentials || DEFAULT_STATE.credentials;
                if (pwd === currentCreds.system) {
                    sessionStorage.setItem('app_unlocked', 'true');
                    document.getElementById('main-login-error').classList.add('hidden');
                    this.checkMainLogin();
                } else {
                    document.getElementById('main-login-error').classList.remove('hidden');
                    document.getElementById('app-password').value = '';
                }
            });

            // Force Enter key binding specifically for this input field
            const pwdInput = document.getElementById('app-password');
            if (pwdInput) {
                pwdInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        form.dispatchEvent(new Event('submit'));
                    }
                });
            }
        }
    }

    async loadState() {
        console.log("Iniciando sincronização em tempo real...");
        
        // 1. Tentar carregar backup local instantaneamente para evitar tela em branco
        const localBackup = localStorage.getItem('noor_state');
        let localState = null;
        if (localBackup) {
            try {
                localState = JSON.parse(localBackup);
                if (localState) {
                    this.state = localState;
                    if (!this.state.credentials) this.state.credentials = { ...DEFAULT_STATE.credentials };
                    this.updateSalespersonSelects();
                    this.refreshCurrentView();
                }
            } catch (e) {
                console.error("Erro ao ler backup local", e);
            }
        }

        // 2. Conectar Listener em Tempo Real (onValue) do Firebase Realtime Database
        const stateRef = ref(db, 'noor_state');
        onValue(stateRef, (snapshot) => {
            if (snapshot.exists()) {
                const cloudVal = snapshot.val() || {};
                const cloudSales = cloudVal.sales || [];
                const cloudInventory = cloudVal.inventory || [];
                const cloudSalespersons = cloudVal.salespersons || [];
                const cloudCredentials = cloudVal.credentials || { ...DEFAULT_STATE.credentials };

                let localSales = localState ? (localState.sales || []) : [];
                let localInventory = localState ? (localState.inventory || []) : [];
                let localSalespersons = localState ? (localState.salespersons || []) : [];

                // Verificar se existem vendas locais no navegador que não estão no cloud
                const cloudSaleIds = new Set(cloudSales.map(s => String(s.id)));
                const missingLocalSales = localSales.filter(s => s && s.id && !cloudSaleIds.has(String(s.id)));

                // Mesclar vendas, estoque e vendedores por ID sem sobrescrever
                const mergedSales = mergeArrayById(cloudSales, localSales);
                mergedSales.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

                const mergedInventory = mergeArrayById(cloudInventory, localInventory);
                const mergedSalespersons = mergeArrayById(cloudSalespersons, localSalespersons);

                this.state = {
                    inventory: mergedInventory,
                    sales: mergedSales,
                    salespersons: mergedSalespersons,
                    credentials: cloudCredentials
                };

                // Atualizar backup local
                localStorage.setItem('noor_state', JSON.stringify(this.state));

                // Se havia vendas perdidas no localStorage deste navegador, sincronizar para o Firebase
                if (missingLocalSales.length > 0) {
                    console.log(`Recuperadas ${missingLocalSales.length} vendas locais! Enviando para o Firebase...`);
                    this.showToast(`📢 ${missingLocalSales.length} venda(s) recuperada(s) do navegador local e sincronizada(s)!`);
                    set(ref(db, 'noor_state'), this.state)
                        .catch(err => console.error('Erro ao enviar vendas recuperadas:', err));
                }

                console.log("Dados sincronizados em tempo real. Total de vendas:", this.state.sales.length);
            } else {
                if (localState) {
                    this.saveState();
                } else {
                    this.state = { ...DEFAULT_STATE };
                    this.saveState();
                }
            }

            this.updateSalespersonSelects();
            this.refreshCurrentView();
        }, (error) => {
            console.error("Erro na conexão em tempo real do Firebase:", error);
        });
    }

    refreshCurrentView() {
        const hash = window.location.hash || '#dashboard';
        if (hash === '#inventory') this.renderInventory();
        else if (hash === '#pos') this.renderPOSProducts();
        else if (hash === '#reports') this.renderReports();
        else this.renderDashboard();
    }

    saveState() {
        if (!this.state) return;
        
        // Garante que o backup local está salvo
        localStorage.setItem('noor_state', JSON.stringify(this.state));
        
        // Realiza mesclagem não destrutiva com o estado mais recente do Firebase antes do set
        get(child(ref(db), 'noor_state')).then((snapshot) => {
            let stateToSave = this.state;
            if (snapshot.exists()) {
                const cloudVal = snapshot.val() || {};
                stateToSave = {
                    inventory: mergeArrayById(this.state.inventory, cloudVal.inventory),
                    sales: mergeArrayById(this.state.sales, cloudVal.sales),
                    salespersons: mergeArrayById(this.state.salespersons, cloudVal.salespersons),
                    credentials: this.state.credentials || cloudVal.credentials || DEFAULT_STATE.credentials
                };
                stateToSave.sales.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
                this.state = stateToSave;
                localStorage.setItem('noor_state', JSON.stringify(this.state));
            }
            
            set(ref(db, 'noor_state'), stateToSave)
                .then(() => console.log('Sincronizado com a nuvem com sucesso'))
                .catch((error) => console.error('Falha ao salvar na nuvem', error));
        }).catch(() => {
            set(ref(db, 'noor_state'), this.state)
                .then(() => console.log('Sincronizado com a nuvem (direto)'))
                .catch((error) => console.error('Falha ao salvar na nuvem', error));
        });
    }

    init() {
        this.setupRouter();
        this.setupEventListeners();
        this.updateSalespersonSelects();
    }

    setupRouter() {
        const handleRoute = () => {
            const hash = window.location.hash || '#dashboard';

            this.lastValidHash = hash;

            // Update active nav
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            document.querySelector(`#nav-${hash.substring(1)}`)?.classList.add('active');
            
            // Hide all views
            document.querySelectorAll('.view-container').forEach(el => el.classList.add('hidden'));
            
            // Show target view
            const targetView = document.querySelector(`#view-${hash.substring(1)}`);
            if (targetView) targetView.classList.remove('hidden');

            // Update Page Title
            const titles = {
                '#dashboard': 'Painel',
                '#inventory': 'Gestão de Estoques',
                '#pos': 'Ponto de Venda',
                '#reports': 'Relatórios Diários'
            };
            document.getElementById('page-title').innerText = titles[hash] || 'Painel';

            // Specific renders
            if (hash === '#dashboard') this.renderDashboard();
            if (hash === '#inventory') this.renderInventory();
            if (hash === '#pos') this.renderPOS();
            if (hash === '#reports') this.renderReports();
        };

        window.addEventListener('hashchange', handleRoute);
        handleRoute(); // Call on load
    }

    setupEventListeners() {
        const adminForm = document.getElementById('login-form');
        if (adminForm) {
            adminForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });

            const adminPwdInput = document.getElementById('admin-password');
            if (adminPwdInput) {
                adminPwdInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        adminForm.dispatchEvent(new Event('submit'));
                    }
                });
            }
        }

        const settingsForm = document.getElementById('settings-form');
        if (settingsForm) {
            settingsForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveSettings();
            });
        }

        document.getElementById('product-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveProduct();
        });



        const sf = document.getElementById('salesperson-form');
        if(sf) sf.addEventListener('submit', (e) => {
            e.preventDefault();
            this.addSalesperson();
        });

        const ef = document.getElementById('edit-sale-form');
        if(ef) ef.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveSaleEdit();
        });

        const rf = document.getElementById('report-salesperson-filter');
        if(rf) rf.addEventListener('change', () => this.renderReports());

        document.getElementById('search-inventory').addEventListener('input', (e) => {
            this.renderInventory(e.target.value);
        });

        document.getElementById('search-pos').addEventListener('input', (e) => {
            this.renderPOSProducts(e.target.value);
        });

        document.getElementById('btn-checkout').addEventListener('click', () => {
            this.processCheckout();
        });

        document.getElementById('sale-discount').addEventListener('input', () => {
            this.renderCart();
        });
        const reportDateStart = document.getElementById('report-date-start');
        const reportDateEnd = document.getElementById('report-date-end');
        if (reportDateStart && reportDateEnd) {
            reportDateStart.addEventListener('change', () => this.renderReports());
            reportDateEnd.addEventListener('change', () => this.renderReports());
        }

        // Global keydown listener for physical barcode scanner
        document.addEventListener('keydown', (e) => this.handleGlobalKeydown(e));
    }

    handleGlobalKeydown(e) {
        // Exclude specific targets where rapid typing is expected, like search inputs, if necessary.
        // But since scanners are super fast, we can reliably distinguish from a human typing.
        const currentTime = new Date().getTime();
        
        // Typical barcode scanner keystroke interval is < 20ms. We use 50ms as the threshold for human vs scanner typing.
        if (currentTime - this.lastKeystrokeTime > 50) {
            this.barcodeBuffer = ''; // Reset buffer if it's too slow to be a scanner
        }
        
        this.lastKeystrokeTime = currentTime;

        // Note: A scanner ends its scan sequence with an 'Enter' keypress.
        if (e.key === 'Enter' && this.barcodeBuffer.length > 5) {
            this.processBarcodeScan(this.barcodeBuffer);
            this.barcodeBuffer = '';
            
            // Prevent default form submissions if it was a scanned Enter
            if (e.target.tagName !== 'BUTTON') {
                e.preventDefault();
            }
        } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            this.barcodeBuffer += e.key;
        }
    }

    processBarcodeScan(barcode) {
        const hash = window.location.hash || '#dashboard';

        if (hash === '#pos') {
            const product = this.state.inventory.find(p => p.barcode === barcode);
            if (product) {
                if (product.stock > 0) {
                    this.addToCart(product);
                    this.showToast('Item adicionado: ' + product.name);
                } else {
                    this.showToast('Sem estoque para: ' + product.name, true);
                }
            } else {
                this.showToast('Produto não encontrado, código: ' + barcode, true);
            }
        } 
        else if (hash === '#inventory') {
            const product = this.state.inventory.find(p => p.barcode === barcode);
            if (product) {
                this.editProduct(product.id);
                this.showToast('Aberta edição de: ' + product.name);
            } else {
                if (this.isAdmin) {
                    this.openAddProductModal();
                    document.getElementById('product-barcode').value = barcode;
                    this.showToast('Buscando informações globlais do produto...');
                    
                    this.fetchProductInfo(barcode).then(info => {
                        const helper = document.getElementById('google-search-helper');
                        if (info && (info.name || info.brand)) {
                            if (info.name) document.getElementById('product-name').value = info.name;
                            if (info.brand) document.getElementById('product-brand').value = info.brand;
                            this.showToast('Produto encontrado na base de dados global!', false);
                            if (helper) helper.style.display = 'none';
                        } else if (info && info.error) {
                            this.showToast(info.error, true);
                        } else {
                            this.showToast('Produto não encontrado nas bases globais. Preencha manualmente.', true);
                            if (helper) {
                                helper.href = `https://www.google.com/search?q=${barcode}`;
                                helper.style.display = 'flex';
                            }
                        }
                    });

                } else {
                    this.showToast('Novo código lido, mas requer Modo Administrador.', true);
                }
            }
        } else {
            this.showToast('Código lido: ' + barcode);
        }
    }

    manualBarcodeFetch() {
        const barcode = document.getElementById('product-barcode').value.trim();
        if (!barcode) {
            this.showToast('Por favor, digite um código de barras primeiro.', true);
            return;
        }

        this.showToast('Buscando informações globlais do produto...');
        
        this.fetchProductInfo(barcode).then(info => {
            const helper = document.getElementById('google-search-helper');
            if (info && (info.name || info.brand)) {
                if (info.name) document.getElementById('product-name').value = info.name;
                if (info.brand) document.getElementById('product-brand').value = info.brand;
                this.showToast('Produto encontrado na base de dados global!', false);
                if (helper) helper.style.display = 'none';
            } else if (info && info.error) {
                this.showToast(info.error, true);
            } else {
                this.showToast('Produto não encontrado nas bases globais. Preencha manualmente.', true);
                if (helper) {
                    helper.href = `https://www.google.com/search?q=${barcode}`;
                    helper.style.display = 'flex';
                }
            }
        });
    }

    async fetchProductInfo(barcode) {
        // Try OpenBeautyFacts API for cosmetics
        try {
            const obfResponse = await fetch(`https://world.openbeautyfacts.org/api/v1/product/${barcode}.json`);
            if (obfResponse.ok) {
                const obfData = await obfResponse.json();
                if (obfData.status === 1 && obfData.product) {
                    const name = obfData.product.product_name || '';
                    const brand = obfData.product.brands || '';
                    if (name || brand) {
                        return { name, brand };
                    }
                }
            }
        } catch (e) {
            console.warn('OpenBeautyFacts lookup failed:', e);
        }

        // Try OpenFoodFacts API fallback (has many beauty products too and relies on same backend format)
        try {
            const offResponse = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
            if (offResponse.ok) {
                const offData = await offResponse.json();
                if (offData.status === 1 && offData.product) {
                    const name = offData.product.product_name || '';
                    const brand = offData.product.brands || '';
                    if (name || brand) {
                        return { name, brand };
                    }
                }
            }
        } catch (e) {
            console.warn('OpenFoodFacts lookup failed:', e);
        }

        // Fallback to UPCitemdb
        try {
            const upcResponse = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
            if (upcResponse.ok) {
                const upcData = await upcResponse.json();
                if (upcData.items && upcData.items.length > 0) {
                    const title = upcData.items[0].title || '';
                    const brand = upcData.items[0].brand || '';
                    
                    // Filter title since it's sometimes very wordy
                    const nameParts = title.split(',')[0].split('-')[0].trim();
                    
                    return { name: nameParts || title, brand };
                }
            }
        } catch (e) {
            console.warn('UPCitemdb lookup failed:', e);
        }

        // Fallback to BR OpenFoodFacts directly (Localized Brazilian DB)
        try {
            const brResponse = await fetch(`https://br.openfoodfacts.org/api/v0/product/${barcode}.json`);
            if (brResponse.ok) {
                const brData = await brResponse.json();
                if (brData.status === 1 && brData.product) {
                    const name = brData.product.product_name || '';
                    const brand = brData.product.brands || '';
                    if (name || brand) return { name, brand };
                }
            }
        } catch (e) {
             console.warn('BR OFF lookup failed:', e);
        }

        // Fallback to EAN-Search via corsproxy
        try {
            const eanUrl = encodeURIComponent(`https://www.ean-search.org/?q=${barcode}`);
            // Use corsproxy.io which acts flawlessly on local environments
            const response = await fetch(`https://corsproxy.io/?${eanUrl}`);
            if (response.ok) {
                const html = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const aTags = Array.from(doc.querySelectorAll('a'));
                const found = aTags.find(a => a.href.includes('/ean/'));
                if (found && found.innerText && found.innerText.length > 5 && !found.innerText.includes(barcode)) {
                    return { name: found.innerText.trim(), brand: 'EAN Search' };
                }
            }
        } catch (e) {
            console.warn('EANSearch failed:', e);
        }

        // Fallback to Cosmos Bluesoft Scraping via corsproxy
        try {
            const cosmosUrl = encodeURIComponent(`https://cosmos.bluesoft.com.br/produtos/${barcode}`);
            const response = await fetch(`https://corsproxy.io/?${cosmosUrl}`);
            if (response.ok) {
                const html = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const titleEl = doc.querySelector('h1.page-header');
                if (titleEl) {
                    let title = titleEl.innerText.replace(/\n/g, '').trim();
                    if (title && !title.includes('Página não encontrada')) return { name: title, brand: 'Cosmos' };
                }
            }
        } catch(e) {
            console.warn('Cosmos scraping failed:', e);
        }

        // Ultimate Fallback to Yahoo Search via corsproxy (Ignores scrapers better than Google)
        try {
            const searchUrl = encodeURIComponent(`https://br.search.yahoo.com/search?p=${barcode}`);
            const response = await fetch(`https://corsproxy.io/?${searchUrl}`);
            if (response.ok) {
                const html = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                
                // Yahoo organic results are structured in h3 or compTitle
                const headings = Array.from(doc.querySelectorAll('h3.title a, h3 a, .compTitle h3'));
                for (const h3 of headings) {
                    if (h3.innerText && h3.innerText.length > 5 && !h3.innerText.toLowerCase().includes('yahoo')) {
                        let title = h3.innerText.replace(/[\n\r]/g, '').trim();
                        if (title && !title.includes(barcode)) {
                            return { name: title, brand: 'Busca Online' };
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Yahoo Search scraping failed:', e);
        }

        // Incredible Fallback: Go-UPC Scraping (Bypasses Google API completely)
        try {
            const goUpcUrl = encodeURIComponent(`https://go-upc.com/search?q=${barcode}`);
            const response = await fetch(`https://api.allorigins.win/get?url=${goUpcUrl}`);
            if (response.ok) {
                const json = await response.json();
                if (json.contents) {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(json.contents, 'text/html');
                    
                    let title = '';
                    let brand = 'Go-UPC';

                    // Go-UPC stores the absolute product name cleanly in h1
                    const h1El = doc.querySelector('h1.product-name');
                    if (h1El && h1El.innerText) {
                        title = h1El.innerText.trim();
                    } else {
                        const titleEl = doc.querySelector('title');
                        if (titleEl) title = titleEl.innerText.replace(/(?:\s*[-|–—]\s*(?:EAN|UPC).*|\s*[-|–—]\s*Go-UPC.*)/ig, '').trim();
                    }

                    // Extract exact Brand from metadata table
                    const metadataLabels = doc.querySelectorAll('td.metadata-label');
                    metadataLabels.forEach(td => {
                        if (td.innerText.trim().toLowerCase() === 'brand') {
                            const valTd = td.nextElementSibling;
                            if (valTd) brand = valTd.innerText.trim();
                        }
                    });

                    // Strip the brand from the title so it isn't duplicated
                    if (brand !== 'Go-UPC' && title.toLowerCase().startsWith(brand.toLowerCase())) {
                        title = title.substring(brand.length).trim();
                        if (title.startsWith('-') || title.startsWith('|')) {
                            title = title.substring(1).trim();
                        }
                    }

                    if (title.length > 3 && !title.toLowerCase().includes('not found')) {
                        return { name: title, brand: brand };
                    }
                }
            }
        } catch (e) {
            console.warn('Go-UPC scraping failed:', e);
        }

        // Automatic Google Custom Search API Fallback (Disabled as Google restricts new accounts)
        /*
        if (this.state.settings && this.state.settings.googleApiKey && this.state.settings.googleCx) {

            try {
                const cx = this.state.settings.googleCx;
                const apiKey = this.state.settings.googleApiKey;
                const googleUrl = `https://customsearch.googleapis.com/customsearch/v1?q=${barcode}&cx=${cx}&key=${apiKey}`;
                
                const response = await fetch(googleUrl);
                if (response.ok) {
                    const data = await response.json();
                    if (!data.items || data.items.length === 0) {
                        return { error: 'Google API: Nenhuma página encontrada na web para este código.' };
                    }
                    if (data.items && data.items.length > 0) {
                        for (const item of data.items) {
                            if (item.title) {
                                // Avoid generic Google search references
                                if (item.title.toLowerCase().includes('google search')) continue;
                                
                                let title = item.title;
                                // Split by delimiters commonly used for SEO store branding
                                title = title.split('-')[0].split('|')[0].trim();
                                // Clean out the barcode exactly if it's there
                                title = title.replace(new RegExp(barcode, 'gi'), '').trim();
                                
                                if (title.length > 3 && !/^\d+$/.test(title)) {
                                    return { name: title, brand: 'Busca Online Google' };
                                }
                            }
                        }
                        return { error: 'Google API: Encontrou resultados na web, mas o nome do produto parecia vazio/inválido.' };
                    }
                } else {
                    const errText = await response.text();
                    console.warn('Google API return error', errText);
                    try {
                        const errJson = JSON.parse(errText);
                        if (errJson.error && errJson.error.message) {
                            // Translate common errors if possible, or print directly
                            let msg = errJson.error.message;
                            if (msg.includes('API key not valid')) msg = 'A API Key colocada é inválida ou possui erro de digitação.';
                            if (msg.includes('not enabled') || msg.includes('does not have the access')) msg = 'O serviço "Custom Search API" não foi ativado no painel do Google Cloud para esta Key.';
                            if (msg.includes('requests per day')) msg = 'O limite gratuito de 100 buscas por dia foi atingido.';
                            return { error: `Bloqueio do Google: ${msg}` };
                        }
                    } catch(e) {}
                    return { error: 'Google API Erro HTTP: Key ou CX inválidos ou restritos!' };
                }
            } catch (e) {
                console.warn('Google Custom Search API failed:', e);
                return { error: 'Google API Erro: Falha na conexão da busca manual.' };
            }
        }
        */

        return null;
    }

    // --- Dashboard ---
    renderDashboard() {
        const todayStr = new Date().toLocaleDateString('en-CA'); // 'YYYY-MM-DD' properly padded in local timezone

        let totalStockValue = 0;
        this.state.inventory.forEach(item => {
            totalStockValue += (item.cost || 0) * item.stock;
        });

        let totalRevenue = 0;
        let totalCost = 0;
        let itemsSold = 0;
        
        // Use 'en-CA' local date to match how we save it or parse it. 
        // Our sale.date is an ISO date string (UTC), but for dashboard we match local 'today'.
        const todaySales = this.state.sales.filter(sale => {
            const saleDate = new Date(sale.date);
            const formattedSaleDate = saleDate.getFullYear() + '-' + 
                                      String(saleDate.getMonth() + 1).padStart(2, '0') + '-' + 
                                      String(saleDate.getDate()).padStart(2, '0');
            return formattedSaleDate === todayStr;
        });

        todaySales.forEach(sale => {
            totalRevenue += sale.total;
            totalCost += (sale.totalCost || 0);
            sale.items.forEach(i => itemsSold += i.qty);
        });

        const netProfit = totalRevenue - totalCost;

        document.getElementById('total-stock-value').innerText = formatCurrency(totalStockValue);
        document.getElementById('total-revenue').innerText = formatCurrency(totalRevenue);
        document.getElementById('total-items-sold').innerText = itemsSold;
        const profitEl = document.getElementById('total-net-profit');
        if (profitEl) profitEl.innerText = formatCurrency(netProfit);

        // Recent sales table
        const tbody = document.getElementById('recent-sales-body');
        tbody.innerHTML = '';
        
        const recentSales = [...todaySales].reverse().slice(0, 5);
        
        if (recentSales.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-secondary);">Nenhuma venda ainda</td></tr>';
            return;
        }

        recentSales.forEach(sale => {
            const itemNames = sale.items.map(i => `${i.name} (x${i.qty})`).join(', ');
            const date = new Date(sale.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${date}</td>
                <td>${itemNames}</td>
                <td>${sale.items.reduce((sum, i) => sum + i.qty, 0)}</td>
                <td>${formatCurrency(sale.total)}</td>
            `;
            tbody.appendChild(tr);
        });
        
        if (window.feather) feather.replace();
    }

    // --- Inventory ---
    renderInventory(searchQuery = '') {
        const tbody = document.getElementById('inventory-body');
        tbody.innerHTML = '';

        let filtered = this.state.inventory;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(item => 
                item.name.toLowerCase().includes(q) || item.brand.toLowerCase().includes(q)
            );
        }

        filtered.forEach(item => {
            const tr = document.createElement('tr');
            
            let stockBadge = `<span class="good-stock">${item.stock}</span>`;
            if (item.stock <= 5) {
                stockBadge = `<span class="low-stock">${item.stock}</span>`;
            }

            tr.innerHTML = `
                <td><strong>${item.name}</strong></td>
                <td>${item.brand}</td>
                <td>${stockBadge}</td>
                <td style="color: var(--text-secondary);">${formatCurrency(Number(item.cost || 0))}</td>
                <td style="color: var(--accent-gold); font-weight: 500;">${formatCurrency(Number(item.price))}</td>
                <td>
                    <div class="action-btns">
                        <button class="icon-btn" onclick="app.editProduct('${item.id}')" title="Editar"><i data-feather="edit-2"></i></button>
                        <button class="icon-btn" style="color: var(--danger)" onclick="app.confirmDelete('${item.id}')" title="Excluir"><i data-feather="trash-2"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
        
        if (window.feather) feather.replace();
    }

    openLoginModal(actionCallback) {
        this.pendingAction = actionCallback;
        document.getElementById('login-form').reset();
        document.getElementById('login-modal').classList.remove('hidden');
    }

    closeLoginModal() {
        document.getElementById('login-modal').classList.add('hidden');
        this.pendingAction = null;
    }

    handleLogin() {
        const pwd = document.getElementById('admin-password').value;
        const currentCreds = this.state.credentials || DEFAULT_STATE.credentials;
        if (pwd === currentCreds.admin) {
            this.isAdmin = true;
            const action = this.pendingAction;
            this.closeLoginModal();
            if (action) {
                action();
            }
            this.showToast('Login efetuado com sucesso.');
        } else {
            this.showToast('Senha incorreta!', true);
            document.getElementById('admin-password').value = '';
        }
    }

    toggleAdminState() {
        if (this.isAdmin) {
            this.isAdmin = false;
            this.updateAdminUI();
            this.showToast('Modo Vendedor ativado.');
        } else {
            this.openLoginModal(() => {
                this.updateAdminUI();
                this.showToast('Modo Administrador ativado com sucesso.');
            });
        }
    }

    showToast(msg, isError = false) {
        const toast = document.getElementById('toast-notification');
        if (!toast) return;
        document.getElementById('toast-msg').innerText = msg;
        toast.style.borderLeftColor = isError ? 'var(--danger)' : 'var(--accent-gold)';
        toast.classList.remove('hidden');
        toast.style.opacity = '1';
        
        if (this.toastTimeout) clearTimeout(this.toastTimeout);
        this.toastTimeout = setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.classList.add('hidden'), 300);
        }, 3000);
    }

    updateAdminUI() {
        const avatar = document.getElementById('admin-avatar');
        const manageSpBtn = document.getElementById('btn-manage-salespersons');
        const settingsBtn = document.getElementById('btn-settings');
        if (this.isAdmin) {
            if(avatar) {
                avatar.innerHTML = '<i data-feather="unlock"></i>';
                avatar.style.color = 'var(--accent-gold)';
                avatar.style.borderColor = 'var(--accent-gold)';
            }
            if(manageSpBtn) manageSpBtn.style.display = 'inline-block';
            if(settingsBtn) settingsBtn.style.display = 'inline-block';
        } else {
            if(avatar) {
                avatar.innerHTML = '<i data-feather="lock"></i>';
                avatar.style.color = 'var(--text-secondary)';
                avatar.style.borderColor = 'var(--border-color)';
            }
            if(manageSpBtn) manageSpBtn.style.display = 'none';
            if(settingsBtn) settingsBtn.style.display = 'none';
        }
        if (window.feather) feather.replace();
    }

    openAddProductModal() {
        if (!this.isAdmin) {
            this.showToast('Ação bloqueada: Por favor, ative o Modo Administrador no topo.', true);
            return;
        }
        document.getElementById('product-form').reset();
        document.getElementById('product-id').value = '';
        document.getElementById('modal-title').innerText = 'Adicionar Perfume';
        
        const helper = document.getElementById('google-search-helper');
        if (helper) helper.style.display = 'none';
        
        document.getElementById('product-modal').classList.remove('hidden');
    }

    closeModal() {
        document.getElementById('product-modal').classList.add('hidden');
    }

    saveProduct() {
        const id = document.getElementById('product-id').value;
        const name = document.getElementById('product-name').value;
        const brand = document.getElementById('product-brand').value;
        const cost = parseFloat(document.getElementById('product-cost').value) || 0;
        const price = parseFloat(document.getElementById('product-price').value) || 0;
        const stock = parseInt(document.getElementById('product-stock').value, 10) || 0;
        const barcode = document.getElementById('product-barcode').value || '';

        if (id) {
            // Update
            const idx = this.state.inventory.findIndex(i => i.id === id);
            if (idx !== -1) {
                this.state.inventory[idx] = { id, name, brand, cost, price, stock, barcode };
            }
        } else {
            // Create
            const newId = Date.now().toString();
            this.state.inventory.push({ id: newId, name, brand, cost, price, stock, barcode });
        }

        this.saveState();
        this.closeModal();
        this.renderInventory();
        this.renderDashboard();
    }

    editProduct(id) {
        if (!this.isAdmin) {
            this.showToast('Ação bloqueada: Por favor, ative o Modo Administrador no topo.', true);
            return;
        }
        const product = this.state.inventory.find(i => i.id === id);
        if (!product) return;

        document.getElementById('product-id').value = product.id;
        document.getElementById('product-name').value = product.name;
        document.getElementById('product-brand').value = product.brand;
        document.getElementById('product-cost').value = product.cost || 0;
        document.getElementById('product-price').value = product.price || 0;
        document.getElementById('product-stock').value = product.stock || 0;
        document.getElementById('product-barcode').value = product.barcode || '';
        
        const helper = document.getElementById('google-search-helper');
        if (helper) helper.style.display = 'none';
        
        document.getElementById('modal-title').innerText = 'Editar Perfume';
        document.getElementById('product-modal').classList.remove('hidden');
    }

    confirmDelete(id) {
        if (!this.isAdmin) {
            this.showToast('Ação bloqueada: Por favor, ative o Modo Administrador no topo.', true);
            return;
        }
        document.getElementById('confirm-modal').classList.remove('hidden');
        document.getElementById('confirm-yes-btn').onclick = () => {
            this.state.inventory = this.state.inventory.filter(i => i.id !== id);
            this.saveState();
            const searchInput = document.getElementById('search-inventory');
            this.renderInventory(searchInput ? searchInput.value : '');
            this.renderDashboard();
            this.renderPOSProducts();
            this.closeConfirm();
            this.showToast('Produto excluído com sucesso.');
        };
    }

    closeConfirm() {
        document.getElementById('confirm-modal').classList.add('hidden');
    }

    // --- POS ---
    renderPOS() {
        this.cart = [];
        this.renderPOSProducts();
        this.renderCart();
    }

    renderPOSProducts(searchQuery = '') {
        const grid = document.getElementById('pos-products-grid');
        grid.innerHTML = '';

        let filtered = [...this.state.inventory];
        // Sort: in stock (stock > 0) first, out of stock last
        filtered.sort((a, b) => {
            const aInStock = (a.stock > 0) ? 1 : 0;
            const bInStock = (b.stock > 0) ? 1 : 0;
            return bInStock - aInStock;
        });

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(item => 
                item.name.toLowerCase().includes(q) || item.brand.toLowerCase().includes(q)
            );
        }

        filtered.forEach(item => {
            const isOutOfStock = item.stock <= 0;
            const div = document.createElement('div');
            div.className = isOutOfStock ? 'product-card out-of-stock' : 'product-card';
            div.onclick = () => this.addToCart(item);
            
            const stockDisplay = isOutOfStock 
                ? `<span style="font-size: 12px; color: var(--danger); font-weight: 500;">Sem Estoque</span>`
                : `<span style="font-size: 12px; color: var(--text-secondary);">Estoque: ${item.stock}</span>`;

            div.innerHTML = `
                <div>
                    <h4 style="color: var(--text-primary); margin-bottom: 4px;">${item.name}</h4>
                    <p style="color: var(--text-secondary); font-size: 12px; margin-bottom: 12px;">${item.brand}</p>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: var(--accent-gold); font-weight: 600;">${formatCurrency(Number(item.price))}</span>
                    ${stockDisplay}
                </div>
            `;
            grid.appendChild(div);
        });
    }

    addToCart(product) {
        if (product.stock <= 0) {
            this.showToast('Este produto está sem estoque disponível', true);
            return;
        }
        const existing = this.cart.find(item => item.id === product.id);
        if (existing) {
            if (existing.qty < product.stock) {
                existing.qty += 1;
            } else {
                this.showToast('Não é possível exceder o estoque disponível', true);
            }
        } else {
            this.cart.push({ ...product, qty: 1 });
        }
        this.renderCart();
    }

    updateCartQty(id, delta) {
        const item = this.cart.find(i => i.id === id);
        if (!item) return;

        const product = this.state.inventory.find(i => i.id === id);
        
        if (item.qty + delta > product.stock) {
            this.showToast('Não é possível exceder o estoque disponível', true);
            return;
        }

        item.qty += delta;
        if (item.qty <= 0) {
            this.cart = this.cart.filter(i => i.id !== id);
        }
        
        this.renderCart();
    }

    renderCart() {
        const container = document.getElementById('cart-items');
        container.innerHTML = '';

        if (this.cart.length === 0) {
            container.innerHTML = '<div class="empty-cart">Selecione um produto para iniciar a venda</div>';
            document.getElementById('cart-subtotal').innerText = 'R$ 0,00';
            document.getElementById('cart-total').innerText = 'R$ 0,00';
            document.getElementById('btn-checkout').disabled = true;
            return;
        }

        let subtotal = 0;

        this.cart.forEach(item => {
            const lineTotal = item.price * item.qty;
            subtotal += lineTotal;

            const div = document.createElement('div');
            div.className = 'cart-item';
            div.innerHTML = `
                <div class="cart-item-info">
                    <strong>${item.name}</strong>
                    <span>${formatCurrency(item.price)}</span>
                </div>
                <div class="qty-control">
                    <button class="qty-btn" onclick="app.updateCartQty('${item.id}', -1)"><i data-feather="minus" style="width: 14px;"></i></button>
                    <span>${item.qty}</span>
                    <button class="qty-btn" onclick="app.updateCartQty('${item.id}', 1)"><i data-feather="plus" style="width: 14px;"></i></button>
                </div>
                <div style="font-weight: 600;">${formatCurrency(lineTotal)}</div>
            `;
            container.appendChild(div);
        });

        const discountInput = parseFloat(document.getElementById('sale-discount').value) || 0;
        const total = Math.max(0, subtotal - discountInput);

        document.getElementById('cart-subtotal').innerText = formatCurrency(subtotal);
        document.getElementById('cart-total').innerText = formatCurrency(total);
        document.getElementById('btn-checkout').disabled = false;
        
        if (window.feather) feather.replace();
    }

    processCheckout() {
        if (this.cart.length === 0) return;

        let subtotal = 0;
        let totalCost = 0;
        // Deduct from inventory
        this.cart.forEach(cartItem => {
            const inventoryItem = this.state.inventory.find(i => i.id === cartItem.id);
            const itemCost = inventoryItem ? (parseFloat(inventoryItem.cost) || 0) : 0;
            if (inventoryItem) {
                inventoryItem.stock -= cartItem.qty;
            }
            subtotal += cartItem.price * cartItem.qty;
            totalCost += itemCost * cartItem.qty;
        });

        const discount = parseFloat(document.getElementById('sale-discount').value) || 0;
        const total = Math.max(0, subtotal - discount);
        const clientName = document.getElementById('client-name').value.trim();
        const clientPhoneInput = document.getElementById('client-phone').value;
        const clientPhone = clientPhoneInput.replace(/\D/g, ''); // Remove non-digits
        
        const paymentMethodEl = document.getElementById('sale-payment-method');
        const salespersonEl = document.getElementById('sale-salesperson');
        const paymentMethod = paymentMethodEl ? paymentMethodEl.value : '';
        const salespersonId = salespersonEl ? salespersonEl.value : '';

        // Record sale
        const sale = {
            id: Date.now().toString(),
            date: new Date().toISOString(),
            items: [...this.cart],
            total: total,
            subtotal: subtotal,
            totalCost: totalCost,
            discount: discount,
            clientName: clientName,
            clientPhone: clientPhone,
            paymentMethod: paymentMethod,
            salespersonId: salespersonId
        };
        this.state.sales.push(sale);

        // Save and reset
        this.saveState();
        const cartItemsCopy = [...this.cart];
        this.cart = [];
        
        document.getElementById('client-name').value = '';
        document.getElementById('client-phone').value = '';
        document.getElementById('sale-discount').value = '';
        
        this.showToast('Venda finalizada com sucesso!');
        
        // Generate WhatsApp message
        if (clientPhone) {
            const itemsText = cartItemsCopy.map(i => `${i.qty}x ${i.name} (${formatCurrency(i.price)})`).join('\n');
            let msg = `Olá${clientName ? ' ' + clientName : ''}! 🎉\n\nMuito obrigado por sua compra na Noor Cosméticos. Aqui está o resumo do seu pedido:\n\n${itemsText}\n\nSubtotal: ${formatCurrency(subtotal)}`;
            if (discount > 0) {
                msg += `\nDesconto: ${formatCurrency(discount)}`;
            }
            msg += `\n*Total: ${formatCurrency(total)}*\n\nAgradecemos a preferência e esperamos vê-la(o) em breve! ✨`;
            
            // Add country code if not present (assuming Brazil 55)
            const finalPhone = clientPhone.startsWith('55') ? clientPhone : '55' + clientPhone;
            window.open('https://wa.me/' + finalPhone + '?text=' + encodeURIComponent(msg), '_blank');
        }

        this.renderCart();
        this.renderPOSProducts(); // Refresh stock in POS view
    }

    // --- Salespersons ---
    openSalespersonsModal() {
        if (!this.isAdmin) return;
        document.getElementById('salespersons-modal').classList.remove('hidden');
        this.renderSalespersons();
    }

    closeSalespersonsModal() {
        document.getElementById('salespersons-modal').classList.add('hidden');
    }

    renderSalespersons() {
        const tbody = document.getElementById('salespersons-body');
        if(tbody) {
            tbody.innerHTML = '';
            this.state.salespersons.forEach(sp => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${sp.name}</td>
                    <td>${sp.commission}%</td>
                    <td>
                        <button class="icon-btn" style="color: var(--danger)" onclick="app.deleteSalesperson('${sp.id}')" title="Excluir"><i data-feather="trash-2"></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
        this.updateSalespersonSelects();
        if (window.feather) feather.replace();
    }
    
    updateSalespersonSelects() {
        const posSelect = document.getElementById('sale-salesperson');
        const reportSelect = document.getElementById('report-salesperson-filter');
        
        if (posSelect) {
            posSelect.innerHTML = '<option value="">Sem Vendedor</option>';
            this.state.salespersons.forEach(sp => {
                posSelect.innerHTML += `<option value="${sp.id}">${sp.name}</option>`;
            });
        }
        if (reportSelect) {
            const currentVal = reportSelect.value;
            reportSelect.innerHTML = '<option value="">Todos os Vendedores</option>';
            this.state.salespersons.forEach(sp => {
                reportSelect.innerHTML += `<option value="${sp.id}">${sp.name}</option>`;
            });
            reportSelect.value = currentVal;
        }
    }

    addSalesperson() {
        if (!this.isAdmin) return;
        const nameInput = document.getElementById('sp-name');
        const commInput = document.getElementById('sp-commission');
        
        const sp = {
            id: Date.now().toString(),
            name: nameInput.value.trim(),
            commission: parseFloat(commInput.value) || 0
        };
        
        this.state.salespersons.push(sp);
        this.saveState();
        
        nameInput.value = '';
        commInput.value = '';
        
        this.renderSalespersons();
        this.showToast('Vendedor adicionado.');
    }

    deleteSalesperson(id) {
        if (!this.isAdmin) return;
        this.state.salespersons = this.state.salespersons.filter(sp => sp.id !== id);
        this.saveState();
        this.renderSalespersons();
        this.showToast('Vendedor removido.');
    }

    // --- Edit/Delete Sales ---
    deleteSale(id) {
        if (!this.isAdmin) return;
        if (!confirm('Deseja realmente EXCLUIR essa venda e retornar os itens para o estoque?')) return;

        const saleIndex = this.state.sales.findIndex(s => s.id === id);
        if (saleIndex === -1) return;
        const sale = this.state.sales[saleIndex];

        // Restock inventory
        sale.items.forEach(saleItem => {
            const inventoryItem = this.state.inventory.find(inv => inv.id === saleItem.id);
            if (inventoryItem) {
                inventoryItem.stock += saleItem.qty;
            }
        });

        // Remove sale
        this.state.sales.splice(saleIndex, 1);
        this.saveState();
        
        this.showToast('Venda excluída e estoque restaurado.');
        this.renderReports();
        this.renderDashboard();
    }

    openEditSaleModal(id) {
        if (!this.isAdmin) return;
        const sale = this.state.sales.find(s => s.id === id);
        if (!sale) return;

        document.getElementById('edit-sale-id').value = sale.id;
        document.getElementById('edit-sale-client').value = sale.clientName || '';
        document.getElementById('edit-sale-phone').value = sale.clientPhone || '';
        document.getElementById('edit-sale-payment').value = sale.paymentMethod || 'Dinheiro';
        document.getElementById('edit-sale-discount').value = sale.discount || 0;

        const spSelect = document.getElementById('edit-sale-salesperson');
        spSelect.innerHTML = '<option value="">Sem Vendedor</option>';
        this.state.salespersons.forEach(sp => {
            spSelect.innerHTML += `<option value="${sp.id}">${sp.name}</option>`;
        });
        spSelect.value = sale.salespersonId || '';

        document.getElementById('edit-sale-modal').classList.remove('hidden');
    }

    closeEditSaleModal() {
        document.getElementById('edit-sale-modal').classList.add('hidden');
    }

    saveSaleEdit() {
        const id = document.getElementById('edit-sale-id').value;
        const sale = this.state.sales.find(s => s.id === id);
        if (!sale) return;

        const clientName = document.getElementById('edit-sale-client').value.trim();
        const clientPhoneInput = document.getElementById('edit-sale-phone').value;
        const clientPhone = clientPhoneInput.replace(/\D/g, '');
        const paymentMethod = document.getElementById('edit-sale-payment').value;
        const salespersonId = document.getElementById('edit-sale-salesperson').value;
        const discount = parseFloat(document.getElementById('edit-sale-discount').value) || 0;

        sale.clientName = clientName;
        sale.clientPhone = clientPhone;
        sale.paymentMethod = paymentMethod;
        sale.salespersonId = salespersonId;
        sale.discount = discount;
        
        // Recalculate total if discount changed
        sale.total = Math.max(0, sale.subtotal - discount);

        this.saveState();
        this.closeEditSaleModal();
        this.showToast('Venda editada com sucesso.');
        this.renderReports();
        this.renderDashboard();
    }

    // --- Reports ---
    renderReports() {
        const dateStartInput = document.getElementById('report-date-start');
        const dateEndInput = document.getElementById('report-date-end');
        const todayStr = new Date().toISOString().split('T')[0];
        
        if (!dateStartInput.value) {
            dateStartInput.value = todayStr;
        }
        if (!dateEndInput.value) {
            dateEndInput.value = todayStr;
        }
        
        const startDateStr = dateStartInput.value;
        const endDateStr = dateEndInput.value;
        const spFilter = document.getElementById('report-salesperson-filter')?.value;
        const tbody = document.getElementById('reports-body');
        tbody.innerHTML = '';
        
        let dayRevenue = 0;
        let dayProfit = 0;
        let dayCommission = 0;
        let daySalesCount = 0;

        // Filter sales for this day and salesperson
        const daySales = this.state.sales.filter(sale => {
            const saleDate = new Date(sale.date);
            const formattedSaleDate = saleDate.getFullYear() + '-' + 
                                      String(saleDate.getMonth() + 1).padStart(2, '0') + '-' + 
                                      String(saleDate.getDate()).padStart(2, '0');
            const matchDate = formattedSaleDate >= startDateStr && formattedSaleDate <= endDateStr;
            const matchSp = spFilter ? sale.salespersonId === spFilter : true;
            return matchDate && matchSp;
        });

        if (daySales.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-secondary);">Nenhuma venda registrada neste período</td></tr>';
            document.getElementById('report-sales-count').innerText = 0;
            document.getElementById('report-revenue').innerText = formatCurrency(0);
            document.getElementById('report-profit').innerText = formatCurrency(0);
            document.getElementById('report-commission-container').style.display = 'none';
            return;
        }

        // We want to show latest sales on top
        daySales.reverse().forEach(sale => {
            const saleCost = sale.totalCost || 0;
            const saleProfit = sale.total - saleCost;
            
            dayRevenue += sale.total;
            dayProfit += saleProfit;
            daySalesCount++;
            
            let spName = 'Nenhum';
            let commissionAmt = 0;
            if (sale.salespersonId) {
                const sp = this.state.salespersons.find(s => s.id === sale.salespersonId);
                if (sp) {
                    spName = sp.name;
                    commissionAmt = saleProfit * (sp.commission / 100);
                    dayCommission += commissionAmt;
                }
            }

            const timeStr = new Date(sale.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            
            const itemNames = sale.items.map(i => `${i.qty}x ${i.name}`).join(', ');
            let discountText = sale.discount > 0 ? ` <br><span style="color:var(--danger);font-size:11px;">(Desc: ${formatCurrency(sale.discount)})</span>` : '';
            
            const paymentMethod = sale.paymentMethod || '-';

            let actionsHtml = '<td></td>';
            if (this.isAdmin) {
                actionsHtml = `
                <td>
                    <div style="display:flex; gap:8px;">
                        <button class="icon-btn" onclick="app.openEditSaleModal('${sale.id}')" title="Editar Venda" style="color: var(--accent-gold);"><i data-feather="edit-2"></i></button>
                        <button class="icon-btn" style="color: var(--danger)" onclick="app.deleteSale('${sale.id}')" title="Excluir Venda"><i data-feather="trash-2"></i></button>
                    </div>
                </td>
                `;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${timeStr}</td>
                <td>
                    <strong>${sale.clientName || 'Cliente Balcão'}</strong><br>
                    <span style="font-size: 11px; color: var(--text-secondary);">${sale.clientPhone || '-'}</span>
                </td>
                <td>
                    ${paymentMethod}<br>
                    <span style="font-size: 11px; color: var(--text-secondary);"><i data-feather="user" style="width: 10px; height: 10px;"></i> ${spName}</span>
                </td>
                <td>${itemNames}${discountText}</td>
                <td style="color: #2ecc71; font-weight: 500;">${formatCurrency(saleProfit)}</td>
                <td style="font-weight: 600; color: var(--accent-gold);">${formatCurrency(sale.total)}</td>
                ${actionsHtml}
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('report-sales-count').innerText = daySalesCount;
        document.getElementById('report-revenue').innerText = formatCurrency(dayRevenue);
        document.getElementById('report-profit').innerText = formatCurrency(dayProfit);
        
        const commContainer = document.getElementById('report-commission-container');
        if (spFilter) {
            commContainer.style.display = 'block';
            document.getElementById('report-commission').innerText = formatCurrency(dayCommission);
        } else {
            commContainer.style.display = 'none';
        }

        if (window.feather) feather.replace();
    }

    openSettingsModal() {
        if (!this.isAdmin) return;
        const creds = this.state.credentials || DEFAULT_STATE.credentials;
        document.getElementById('settings-sys-password').value = creds.system;
        document.getElementById('settings-admin-password').value = creds.admin;
        
        document.getElementById('settings-sys-password').type = 'password';
        document.getElementById('settings-admin-password').type = 'password';
        
        // Reset visibility buttons to eye icon
        document.querySelectorAll('#settings-modal .icon-btn').forEach(btn => {
            btn.innerHTML = '<i data-feather="eye"></i>';
        });

        document.getElementById('settings-modal').classList.remove('hidden');
        if (window.feather) feather.replace();
    }

    closeSettingsModal() {
        document.getElementById('settings-modal').classList.add('hidden');
    }

    saveSettings() {
        const system = document.getElementById('settings-sys-password').value;
        const admin = document.getElementById('settings-admin-password').value;
        if (!system || !admin) {
            this.showToast('As senhas não podem ficar em branco.', true);
            return;
        }
        
        if (!this.state.credentials) this.state.credentials = {};
        this.state.credentials.system = system;
        this.state.credentials.admin = admin;
        
        this.saveState();
        this.closeSettingsModal();
        this.showToast('Senhas atualizadas com sucesso!');
    }

    toggleShowPassword(inputId, btn) {
        const input = document.getElementById(inputId);
        if (input) {
            if (input.type === 'password') {
                input.type = 'text';
                btn.innerHTML = '<i data-feather="eye-off"></i>';
            } else {
                input.type = 'password';
                btn.innerHTML = '<i data-feather="eye"></i>';
            }
            if (window.feather) feather.replace();
        }
    }

    resetPasswordsToDefault() {
        this.state.credentials = {
            system: 'NoOr!2026',
            admin: 'RaQuel@2026!'
        };
        this.saveState();
        alert("🚨 CÓDIGO DE RECUPERAÇÃO ATIVADO.\nAs senhas foram restauradas para o padrão original.");
        document.getElementById('app-password').value = '';
    }

    // --- Backup & Data Recovery ---
    scanAndRecoverLocalSales() {
        try {
            let allLocalSales = [];
            let allLocalInventory = [];
            let allLocalSalespersons = [];
            
            // Scan all keys in localStorage for state or sales backups
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) {
                    try {
                        const raw = localStorage.getItem(key);
                        if (raw && (raw.includes('"sales"') || raw.includes('"inventory"') || key.includes('noor'))) {
                            const parsed = JSON.parse(raw);
                            if (parsed && Array.isArray(parsed.sales)) {
                                allLocalSales = mergeArrayById(allLocalSales, parsed.sales);
                            }
                            if (parsed && Array.isArray(parsed.inventory)) {
                                allLocalInventory = mergeArrayById(allLocalInventory, parsed.inventory);
                            }
                            if (parsed && Array.isArray(parsed.salespersons)) {
                                allLocalSalespersons = mergeArrayById(allLocalSalespersons, parsed.salespersons);
                            }
                        }
                    } catch (e) {
                        // Ignore non-JSON keys
                    }
                }
            }

            const currentSaleIds = new Set((this.state.sales || []).map(s => String(s.id)));
            const missingSales = allLocalSales.filter(s => s && s.id && !currentSaleIds.has(String(s.id)));

            if (missingSales.length === 0) {
                this.showToast('Todas as vendas locais deste computador já estão sincronizadas!');
                return;
            }

            // Merge missing sales
            this.state.sales = mergeArrayById(this.state.sales, missingSales);
            this.state.sales.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
            this.state.inventory = mergeArrayById(this.state.inventory, allLocalInventory);
            this.state.salespersons = mergeArrayById(this.state.salespersons, allLocalSalespersons);

            this.saveState();
            this.showToast(`🎉 Sucesso! ${missingSales.length} venda(s) recuperada(s) e sincronizada(s)!`);
            this.refreshCurrentView();
        } catch (e) {
            console.error("Erro na recuperação manual:", e);
            this.showToast('Erro ao escanear vendas locais.', true);
        }
    }

    exportJSONBackup() {
        try {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.state, null, 2));
            const downloadAnchor = document.createElement('a');
            const dateStr = new Date().toISOString().split('T')[0];
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `noor_backup_${dateStr}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
            this.showToast('Backup exportado com sucesso!');
        } catch (e) {
            console.error("Erro ao exportar backup:", e);
            this.showToast('Falha ao exportar backup.', true);
        }
    }

    importJSONBackup(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                if (!importedData.sales && !importedData.inventory) {
                    this.showToast('Arquivo de backup inválido.', true);
                    return;
                }

                const newSales = importedData.sales || [];
                const newInventory = importedData.inventory || [];
                const newSalespersons = importedData.salespersons || [];

                const beforeCount = (this.state.sales || []).length;
                this.state.sales = mergeArrayById(this.state.sales, newSales);
                this.state.sales.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
                
                this.state.inventory = mergeArrayById(this.state.inventory, newInventory);
                this.state.salespersons = mergeArrayById(this.state.salespersons, newSalespersons);

                const addedSales = this.state.sales.length - beforeCount;

                this.saveState();
                this.showToast(`Importação concluída! ${addedSales} nova(s) venda(s) mesclada(s).`);
                this.refreshCurrentView();
            } catch (err) {
                console.error("Erro ao importar JSON:", err);
                this.showToast('Erro ao ler arquivo de backup.', true);
            }
        };
        reader.readAsText(file);
    }
}

// Initialize app when DOM is loaded and expose globally for inline HTML handlers
window.app = new App();
