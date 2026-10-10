const PROVIDERS = [
  { name: 'OpenAI', kind: 'TEXT · IMAGE · AUDIO' },
  { name: 'Anthropic', kind: 'TEXT · REASONING' },
  { name: 'Google Gemini', kind: 'TEXT · IMAGE · VIDEO' },
  { name: 'xAI', kind: 'TEXT · REASONING' },
  { name: 'DeepSeek', kind: 'TEXT · REASONING' },
  { name: 'Mistral AI', kind: 'TEXT · EMBEDDINGS' },
  { name: 'Cohere', kind: 'TEXT · RERANK' },
  { name: 'Alibaba Qwen', kind: 'TEXT · MULTIMODAL' },
  { name: 'ByteDance Seedance', kind: 'VIDEO' },
  { name: 'Stability AI', kind: 'IMAGE · VIDEO' },
  { name: 'ElevenLabs', kind: 'VOICE · AUDIO' },
  { name: 'Replicate', kind: 'MODEL MARKETPLACE' }
];

const BNB_MAINNET = {
  chainId: '0x38',
  chainName: 'BNB Smart Chain',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: ['https://bsc-dataseed.bnbchain.org'],
  blockExplorerUrls: ['https://bscscan.com']
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

export function initServicePanel({ root, getGPU }) {
  let view = 'browse';
  let status = '';
  let selectedProvider = PROVIDERS[0].name;
  let connectedAddress = '';

  const walletButton = document.querySelector('#wallet-button');
  const walletPopover = document.querySelector('#wallet-popover');
  const walletLabel = document.querySelector('#wallet-label');
  const walletMessage = document.querySelector('#wallet-message');
  const walletChoices = document.querySelector('#wallet-choices');
  const walletConnected = document.querySelector('#wallet-connected');
  const walletAddress = document.querySelector('#wallet-address');

  function shortAddress(value) {
    return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Connect BNB wallet';
  }

  function renderWallet() {
    walletLabel.textContent = shortAddress(connectedAddress);
    walletButton.classList.toggle('connected', Boolean(connectedAddress));
    walletButton.setAttribute('aria-label', connectedAddress ? `Wallet ${connectedAddress} · account options` : 'Connect BNB wallet');
    walletChoices.hidden = Boolean(connectedAddress);
    walletConnected.hidden = !connectedAddress;
    walletAddress.textContent = connectedAddress;
  }

  function showWallet(open, restoreFocus = false) {
    walletPopover.hidden = !open;
    walletButton.setAttribute('aria-expanded', String(open));
    if (open) walletPopover.querySelector('button:not(:disabled)')?.focus();
    else if (restoreFocus) walletButton.focus();
  }

  async function ensureBNBMainnet(provider) {
    const chainId = await provider.request({ method: 'eth_chainId' });
    if (chainId?.toLowerCase() === BNB_MAINNET.chainId) return;
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BNB_MAINNET.chainId }]
      });
    } catch (error) {
      if (error?.code !== 4902) throw error;
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [BNB_MAINNET]
      });
    }
  }

  async function connectWallet() {
    walletMessage.textContent = '';
    const provider = window.ethereum;
    if (!provider?.request) {
      walletMessage.textContent = 'Install an EVM browser wallet with BNB support';
      return;
    }
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      await ensureBNBMainnet(provider);
      connectedAddress = accounts?.[0] ?? '';
      renderWallet();
      if (connectedAddress) showWallet(false, true);
    } catch (error) {
      connectedAddress = '';
      renderWallet();
      walletMessage.textContent = error?.code === 4001
        ? 'BNB wallet connection declined'
        : 'Could not connect to BNB Smart Chain';
    }
  }

  walletButton.onclick = () => showWallet(walletPopover.hidden);
  document.querySelector('#wallet-close').onclick = () => showWallet(false, true);
  walletPopover.querySelectorAll('[data-wallet]').forEach(button => button.onclick = connectWallet);
  document.querySelector('#wallet-disconnect').onclick = () => {
    connectedAddress = '';
    walletMessage.textContent = '';
    renderWallet();
    showWallet(false, true);
  };
  document.addEventListener('pointerdown', event => {
    if (!walletPopover.hidden && !event.target.closest('#wallet-control')) showWallet(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !walletPopover.hidden) showWallet(false, true);
  });
  renderWallet();

  function providerOptions() {
    return PROVIDERS.map(provider => `<option${provider.name === selectedProvider ? ' selected' : ''}>${esc(provider.name)}</option>`).join('');
  }

  function providerGrid() {
    return PROVIDERS.map((provider, index) => `
      <button class="market-provider" data-provider="${esc(provider.name)}" aria-label="Select ${esc(provider.name)}">
        <span>${String(index + 1).padStart(2, '0')}</span>
        <strong>${esc(provider.name)}</strong>
        <small>${esc(provider.kind)}</small>
      </button>`).join('');
  }

  function browseView() {
    return `
      <section class="market-card market-intro">
        <p class="market-kicker">AI API LIQUIDITY</p>
        <h2>Turn unused AI capacity into onchain revenue</h2>
        <p>List authorized API capacity without exposing the underlying key to buyers. Requests are designed to pass through an encrypted broker, usage is metered, and sellers receive settlement on BNB</p>
        <div class="market-stats">
          <div><strong>${PROVIDERS.length}</strong><span>provider interfaces</span></div>
          <div><strong>0</strong><span>keys stored locally</span></div>
          <div><strong>BNB</strong><span>settlement layer</span></div>
        </div>
      </section>
      <section class="market-card">
        <p class="market-kicker">SUPPORTED PROVIDERS</p>
        <div class="market-grid">${providerGrid()}</div>
        <p class="market-note">A provider can only be activated when its terms permit the intended resale or delegated-use model</p>
      </section>`;
  }

  function sellView() {
    return `
      <section class="market-card">
        <p class="market-kicker">SELL AI CAPACITY</p>
        <h2>List an API route</h2>
        <p class="market-note">Your secret must be encrypted server-side and never shipped to buyers or stored in this browser</p>
        <label class="market-field">Provider
          <select id="market-provider">${providerOptions()}</select>
        </label>
        <label class="market-field">API key
          <input id="market-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste a provider key">
        </label>
        <div class="market-split">
          <label class="market-field">Price per 1M tokens
            <input id="market-price" type="number" min="0" step="0.01" value="1.00" inputmode="decimal">
          </label>
          <label class="market-field">Daily spend cap
            <input id="market-cap" type="number" min="1" step="1" value="25" inputmode="decimal">
          </label>
        </div>
        <label class="market-check"><input id="market-authorized" type="checkbox"> I am authorized to route this provider capacity and accept its terms</label>
        <button class="market-primary" data-market-action="list">Encrypt and list capacity</button>
      </section>`;
  }

  function buyView() {
    return `
      <section class="market-card">
        <p class="market-kicker">BUY AI TOKENS</p>
        <h2>Route a request through the market</h2>
        <label class="market-field">Provider
          <select id="market-provider">${providerOptions()}</select>
        </label>
        <label class="market-field">Maximum spend in BNB
          <input id="market-budget" type="number" min="0" step="0.001" value="0.01" inputmode="decimal">
        </label>
        <label class="market-field">Workload
          <select id="market-workload">
            <option>Text and reasoning</option>
            <option>Image generation</option>
            <option>Video generation</option>
            <option>Voice and audio</option>
            <option>Embeddings and reranking</option>
          </select>
        </label>
        <button class="market-primary" data-market-action="route">Find the best route</button>
        <p class="market-note">Buyers pay for measured usage. The seller's raw API key is never shown</p>
      </section>`;
  }

  function render() {
    const body = view === 'sell' ? sellView() : view === 'buy' ? buyView() : browseView();
    root.innerHTML = `
      <div class="market-tabs" role="tablist" aria-label="API marketplace">
        <button role="tab" data-market-view="browse" aria-selected="${view === 'browse'}">Market</button>
        <button role="tab" data-market-view="sell" aria-selected="${view === 'sell'}">Sell capacity</button>
        <button role="tab" data-market-view="buy" aria-selected="${view === 'buy'}">Buy tokens</button>
      </div>
      <p id="market-status" class="market-status" role="status">${esc(status)}</p>
      ${body}`;

    root.querySelectorAll('[data-market-view]').forEach(button => button.onclick = () => {
      view = button.dataset.marketView;
      status = '';
      render();
    });
    root.querySelectorAll('[data-provider]').forEach(button => button.onclick = () => {
      selectedProvider = button.dataset.provider;
      view = 'buy';
      status = `${selectedProvider} selected`;
      render();
    });
    root.querySelector('#market-provider')?.addEventListener('change', event => {
      selectedProvider = event.target.value;
    });
    root.querySelector('[data-market-action="list"]')?.addEventListener('click', () => {
      const keyInput = root.querySelector('#market-key');
      const authorized = root.querySelector('#market-authorized')?.checked;
      if (!keyInput?.value.trim()) {
        status = 'Enter an API key before continuing';
      } else if (!authorized) {
        status = 'Confirm that you are authorized to route this API capacity';
      } else {
        keyInput.value = '';
        status = 'Secure key vault and metering backend are not connected in this local build. No API key was stored';
      }
      render();
    });
    root.querySelector('[data-market-action="route"]')?.addEventListener('click', () => {
      status = connectedAddress
        ? 'Routing and BNB settlement require the marketplace backend and contracts. No payment was sent'
        : 'Connect a BNB wallet first. No payment was sent';
      render();
    });
  }

  render();
  return { update: render, refresh: render };
}
