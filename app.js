// Initial State
const DEFAULT_STATE = {
    inventory: [
        { id: '1', name: 'Oud Wood', brand: 'Tom Ford', cost: 150.00, price: 295.00, stock: 15 },
        { id: '2', name: 'Baccarat Rouge 540', brand: 'Maison Francis Kurkdjian', cost: 180.00, price: 325.00, stock: 8 },
        { id: '3', name: 'Aventus', brand: 'Creed', cost: 250.00, price: 495.00, stock: 4 }
    ],
    sales: []
};

// Utils for formatting
function formatCurrency(value) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

class App {
    constructor() {
        this.loadState();
        this.cart = [];
        this.isAdmin = false;
        this.pendingAction = null;
        this.barcodeBuffer = '';
        this.lastKeystrokeTime = 0;
        this.init();
    }

    checkMainLogin() {
        const isUnlocked = sessionStorage.getItem('app_unlocked');
        if (isUnlocked === 'true') {
            document.getElementById('main-login-screen').classList.add('hidden');
            document.getElementById('app-main-content').classList.remove('hidden');
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
                if (pwd === 'NoOr!2026') {
                    sessionStorage.setItem('app_unlocked', 'true');
                    document.getElementById('main-login-error').classList.add('hidden');
                    this.checkMainLogin();
                } else {
                    document.getElementById('main-login-error').classList.remove('hidden');
                    document.getElementById('app-password').value = '';
                }
            });
        }
    }

    loadState() {
        const stored = localStorage.getItem('noor_state');
        if (stored) {
            this.state = JSON.parse(stored);
        } else {
            this.state = { ...DEFAULT_STATE };
            this.saveState();
        }
    }

    saveState() {
        localStorage.setItem('noor_state', JSON.stringify(this.state));
    }

    init() {
        this.checkMainLogin();
        this.initMainLoginEvent();
        this.setupRouter();
        this.setupEventListeners();
        this.renderDashboard();
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
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        document.getElementById('product-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveProduct();
        });

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
                        if (info && (info.name || info.brand)) {
                            if (info.name) document.getElementById('product-name').value = info.name;
                            if (info.brand) document.getElementById('product-brand').value = info.brand;
                            this.showToast('Produto encontrado na base de dados global!', false);
                        } else {
                            this.showToast('Produto não encontrado nas bases globais. Preencha manualmente.', true);
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
            if (info && (info.name || info.brand)) {
                if (info.name) document.getElementById('product-name').value = info.name;
                if (info.brand) document.getElementById('product-brand').value = info.brand;
                this.showToast('Produto encontrado na base de dados global!', false);
            } else {
                this.showToast('Produto não encontrado nas bases globais. Preencha manualmente.', true);
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

        // Fallback to UPCitemdb or OpenFoodFacts if OpenBeautyFacts didn't hit
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

        return null;
    }

    // --- Dashboard ---
    renderDashboard() {
        let totalStockValue = 0;
        this.state.inventory.forEach(item => {
            totalStockValue += item.price * item.stock;
        });

        let totalRevenue = 0;
        let itemsSold = 0;
        this.state.sales.forEach(sale => {
            totalRevenue += sale.total;
            sale.items.forEach(i => itemsSold += i.qty);
        });

        document.getElementById('total-stock-value').innerText = formatCurrency(totalStockValue);
        document.getElementById('total-revenue').innerText = formatCurrency(totalRevenue);
        document.getElementById('total-items-sold').innerText = itemsSold;

        // Recent sales table
        const tbody = document.getElementById('recent-sales-body');
        tbody.innerHTML = '';
        
        const recentSales = [...this.state.sales].reverse().slice(0, 5);
        
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
        if (pwd === 'RaQuel@2026!') {
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
        if (this.isAdmin) {
            if(avatar) {
                avatar.innerHTML = '<i data-feather="unlock"></i>';
                avatar.style.color = 'var(--accent-gold)';
                avatar.style.borderColor = 'var(--accent-gold)';
            }
        } else {
            if(avatar) {
                avatar.innerHTML = '<i data-feather="lock"></i>';
                avatar.style.color = 'var(--text-secondary)';
                avatar.style.borderColor = 'var(--border-color)';
            }
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

        let filtered = this.state.inventory.filter(item => item.stock > 0);
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(item => 
                item.name.toLowerCase().includes(q) || item.brand.toLowerCase().includes(q)
            );
        }

        filtered.forEach(item => {
            const div = document.createElement('div');
            div.className = 'product-card';
            div.onclick = () => this.addToCart(item);
            div.innerHTML = `
                <div>
                    <h4 style="color: var(--text-primary); margin-bottom: 4px;">${item.name}</h4>
                    <p style="color: var(--text-secondary); font-size: 12px; margin-bottom: 12px;">${item.brand}</p>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: var(--accent-gold); font-weight: 600;">${formatCurrency(Number(item.price))}</span>
                    <span style="font-size: 12px; color: var(--text-secondary);">Estoque: ${item.stock}</span>
                </div>
            `;
            grid.appendChild(div);
        });
    }

    addToCart(product) {
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
        // Deduct from inventory
        this.cart.forEach(cartItem => {
            const inventoryItem = this.state.inventory.find(i => i.id === cartItem.id);
            if (inventoryItem) {
                inventoryItem.stock -= cartItem.qty;
            }
            subtotal += cartItem.price * cartItem.qty;
        });

        const discount = parseFloat(document.getElementById('sale-discount').value) || 0;
        const total = Math.max(0, subtotal - discount);
        const clientName = document.getElementById('client-name').value.trim();
        const clientPhoneInput = document.getElementById('client-phone').value;
        const clientPhone = clientPhoneInput.replace(/\D/g, ''); // Remove non-digits

        // Record sale
        const sale = {
            id: Date.now().toString(),
            date: new Date().toISOString(),
            items: [...this.cart],
            total: total,
            subtotal: subtotal,
            discount: discount,
            clientName: clientName,
            clientPhone: clientPhone
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
        const tbody = document.getElementById('reports-body');
        tbody.innerHTML = '';
        
        let dayRevenue = 0;
        let daySalesCount = 0;

        // Filter sales for this day
        const daySales = this.state.sales.filter(sale => {
            const saleDate = new Date(sale.date);
            const formattedSaleDate = saleDate.getFullYear() + '-' + 
                                      String(saleDate.getMonth() + 1).padStart(2, '0') + '-' + 
                                      String(saleDate.getDate()).padStart(2, '0');
            return formattedSaleDate >= startDateStr && formattedSaleDate <= endDateStr;
        });

        if (daySales.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-secondary);">Nenhuma venda registrada neste período</td></tr>';
            document.getElementById('report-sales-count').innerText = 0;
            document.getElementById('report-revenue').innerText = formatCurrency(0);
            return;
        }

        // We want to show latest sales on top
        daySales.reverse().forEach(sale => {
            dayRevenue += sale.total;
            daySalesCount++;

            const timeStr = new Date(sale.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            
            const itemNames = sale.items.map(i => `${i.qty}x ${i.name}`).join(', ');
            let discountText = sale.discount > 0 ? ` <br><span style="color:var(--danger);font-size:11px;">(Desc: ${formatCurrency(sale.discount)})</span>` : '';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${timeStr}</td>
                <td><strong>${sale.clientName || 'Cliente Balcão'}</strong></td>
                <td>${sale.clientPhone || '-'}</td>
                <td>${itemNames}${discountText}</td>
                <td style="font-weight: 600; color: var(--accent-gold);">${formatCurrency(sale.total)}</td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('report-sales-count').innerText = daySalesCount;
        document.getElementById('report-revenue').innerText = formatCurrency(dayRevenue);

        if (window.feather) feather.replace();
    }
}

// Initialize app when DOM is loaded
const app = new App();
