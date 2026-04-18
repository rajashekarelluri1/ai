// ============================================================
// RAJASHEKAR AI — app.js
// All API calls go through backend — API key stays server-side
// ============================================================

// ===== CONFIG =====
const DEFAULT_BACKEND = 'https://rajashekar-ai-backend-production.up.railway.app';
const LOCAL_BACKEND = 'https://rajashekar-ai-backend-production.up.railway.app';

let CONFIG = {
  backendUrl: localStorage.getItem('raj_backend_url') || LOCAL_BACKEND,
  userName: localStorage.getItem('raj_username') || 'Elluri Rajashekar',
  defaultSystemPrompt: localStorage.getItem('raj_system_prompt') || 
    'You are Rajashekar AI, a powerful data intelligence assistant for Elluri Rajashekar, a Data Analyst. You specialize in data analysis, SQL, Python, statistics, data visualization, machine learning, and business intelligence. Be concise, accurate, and provide code examples when helpful.',
  streaming: true,
};

// ===== STATE =====
let state = {
  chats: JSON.parse(localStorage.getItem('raj_chats') || '[]'),
  projects: JSON.parse(localStorage.getItem('raj_projects') || '[]'),
  activeChatId: null,
  pendingImages: [], // [{dataUrl, base64, mimeType, name}]
  isGenerating: false,
};

// ===== DOM REFS =====
const $ = id => document.getElementById(id);
const sidebar = document.querySelector('.sidebar');
const chatContainer = $('chatContainer');
const messagesArea = $('messagesArea');
const welcomeScreen = $('welcomeScreen');
const userInput = $('userInput');
const sendBtn = $('sendBtn');
const chatHistoryList = $('chatHistoryList');
const projectList = $('projectList');
const currentChatName = $('currentChatName');
const currentChatType = $('currentChatType');
const statusDot = $('statusDot');
const imagePreviewStrip = $('imagePreviewStrip');
const charCount = $('charCount');

// ===== UTILITY =====
function uuid() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2);
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function saveChats() {
  localStorage.setItem('raj_chats', JSON.stringify(state.chats));
}

function saveProjects() {
  localStorage.setItem('raj_projects', JSON.stringify(state.projects));
}

function showToast(msg, type = 'info') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => { t.className = 'toast'; }, 3000);
}

function getActiveChat() {
  return state.chats.find(c => c.id === state.activeChatId) || null;
}

// ===== MARKDOWN RENDERER =====
function renderMarkdown(text) {
  let html = text;
  
  // Code blocks
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = codeBlocks.length;
    codeBlocks.push({ lang: lang || 'text', code: code.trim() });
    return `__CODEBLOCK_${id}__`;
  });

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold & italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Blockquote
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Tables
  html = html.replace(/^\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/gm, (match) => {
    const lines = match.trim().split('\n');
    const headers = lines[0].split('|').filter(c => c.trim()).map(h => `<th>${h.trim()}</th>`).join('');
    const rows = lines.slice(2).map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Lists
  html = html.replace(/^(\s*[-*+] .+(\n|$))+/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^\s*[-*+] /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });

  html = html.replace(/^(\s*\d+\. .+(\n|$))+/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^\s*\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // Paragraphs (lines with content)
  html = html.replace(/^(?!<[houltb])(.+)$/gm, (match) => {
    if (match.trim() && !match.startsWith('__CODEBLOCK')) return `<p>${match}</p>`;
    return match;
  });

  // Restore code blocks
  codeBlocks.forEach((cb, i) => {
    const escapedCode = cb.code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const block = `<div class="code-block-wrap">
      <button class="copy-code-btn" onclick="copyCode(this)">Copy</button>
      <pre><code class="lang-${cb.lang}">${escapedCode}</code></pre>
    </div>`;
    html = html.replace(`__CODEBLOCK_${i}__`, block);
  });

  return html;
}

window.copyCode = function(btn) {
  const code = btn.nextElementSibling.querySelector('code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
};

// ===== RENDER SIDEBAR =====
function renderSidebar() {
  // Projects
  if (state.projects.length === 0) {
    projectList.innerHTML = '<div class="empty-list">No projects yet</div>';
  } else {
    projectList.innerHTML = state.projects.map(p => `
      <div class="project-item ${state.activeChatId === p.chatId ? 'active' : ''}" 
           onclick="openProjectChat('${p.id}')">
        <span class="project-dot" style="background:${p.color || '#7C6DFA'}"></span>
        <div class="project-info">
          <span class="project-name">${escHtml(p.name)}</span>
        </div>
        <button class="project-delete" onclick="deleteProject(event,'${p.id}')" title="Delete">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
      </div>
    `).join('');
  }

  // Chats
  const regularChats = state.chats.filter(c => !c.projectId).slice().reverse();
  if (regularChats.length === 0) {
    chatHistoryList.innerHTML = '<div class="empty-list">No chats yet</div>';
  } else {
    chatHistoryList.innerHTML = regularChats.map(c => {
      const lastMsg = c.messages[c.messages.length - 1];
      const preview = lastMsg ? lastMsg.content.substring(0, 40) + '...' : 'Empty chat';
      return `
        <div class="history-item ${state.activeChatId === c.id ? 'active' : ''}"
             onclick="loadChat('${c.id}')">
          <span class="history-dot" style="background:${c.color || 'var(--text3)'}"></span>
          <div class="history-info">
            <span class="history-name">${escHtml(c.name)}</span>
            <span class="history-preview">${escHtml(preview)}</span>
          </div>
          <button class="history-delete" onclick="deleteChat(event,'${c.id}')" title="Delete">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          </button>
        </div>
      `;
    }).join('');
  }
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== CHAT OPERATIONS =====
function createNewChat(name, color, systemPrompt, projectId) {
  const chat = {
    id: uuid(),
    name: name || 'New Chat',
    color: color || null,
    systemPrompt: systemPrompt || CONFIG.defaultSystemPrompt,
    projectId: projectId || null,
    type: projectId ? 'project' : 'chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.chats.push(chat);
  saveChats();
  return chat;
}

function loadChat(chatId) {
  state.activeChatId = chatId;
  const chat = getActiveChat();
  if (!chat) return;

  currentChatName.textContent = chat.name;
  currentChatType.textContent = chat.type === 'group' ? 'Group Chat' :
                                 chat.type === 'project' ? 'Project' : 'Personal';

  welcomeScreen.style.display = 'none';
  messagesArea.classList.add('visible');
  messagesArea.innerHTML = '';

  chat.messages.forEach(msg => renderMessage(msg, false));
  messagesArea.scrollTop = messagesArea.scrollHeight;
  renderSidebar();

  // Mobile: close sidebar
  if (window.innerWidth <= 768) {
    sidebar.classList.remove('open');
    document.querySelector('.sidebar-overlay')?.classList.remove('active');
  }
}

function showWelcome() {
  state.activeChatId = null;
  welcomeScreen.style.display = '';
  messagesArea.classList.remove('visible');
  messagesArea.innerHTML = '';
  currentChatName.textContent = 'Welcome';
  currentChatType.textContent = 'Personal';
  renderSidebar();
}

// ===== RENDER MESSAGE =====
function renderMessage(msg, scroll = true) {
  const isUser = msg.role === 'user';
  const initials = isUser ? 'ER' : 'AI';

  const div = document.createElement('div');
  div.className = 'message';
  div.dataset.id = msg.id;

  let imageHtml = '';
  if (msg.images && msg.images.length > 0) {
    imageHtml = msg.images.map(img =>
      `<img src="${img}" class="msg-image" alt="Attached image"/>`
    ).join('');
  }

  div.innerHTML = `
    <div class="msg-avatar ${isUser ? 'user' : 'ai'}">${isUser ? initials : '✦'}</div>
    <div class="msg-content">
      <div class="msg-header">
        <span class="msg-role">${isUser ? escHtml(CONFIG.userName) : 'Rajashekar AI'}</span>
        <span class="msg-time">${formatTime(msg.timestamp)}</span>
      </div>
      ${imageHtml}
      <div class="msg-body">${isUser ? escHtml(msg.content).replace(/\n/g, '<br>') : renderMarkdown(msg.content)}</div>
      <div class="msg-actions">
        <button class="msg-action-btn" onclick="copyMsg('${msg.id}')">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M3 8H2a1 1 0 01-1-1V2a1 1 0 011-1h5a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.2"/></svg>
          Copy
        </button>
        ${!isUser ? `<button class="msg-action-btn" onclick="regenerate('${msg.id}')">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10 6A4 4 0 116 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 2l1.5-1.5L9 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Regenerate
        </button>` : ''}
      </div>
    </div>
  `;

  messagesArea.appendChild(div);

  if (scroll) {
    setTimeout(() => messagesArea.scrollTop = messagesArea.scrollHeight, 50);
  }

  return div;
}

window.copyMsg = function(id) {
  const chat = getActiveChat();
  if (!chat) return;
  const msg = chat.messages.find(m => m.id === id);
  if (msg) {
    navigator.clipboard.writeText(msg.content).then(() => showToast('Copied!', 'success'));
  }
};

window.regenerate = function(msgId) {
  const chat = getActiveChat();
  if (!chat) return;
  const idx = chat.messages.findIndex(m => m.id === msgId);
  if (idx < 0) return;
  // Remove from this message onwards
  const userMsg = chat.messages[idx - 1];
  chat.messages = chat.messages.slice(0, idx);
  saveChats();
  loadChat(chat.id);
  if (userMsg) sendMessage(userMsg.content, [], true);
};

// ===== TYPING INDICATOR =====
function showTyping() {
  const div = document.createElement('div');
  div.className = 'message';
  div.id = 'typingIndicator';
  div.innerHTML = `
    <div class="msg-avatar ai">✦</div>
    <div class="msg-content">
      <div class="msg-header"><span class="msg-role">Rajashekar AI</span></div>
      <div class="typing-indicator"><span></span><span></span><span></span></div>
    </div>
  `;
  messagesArea.appendChild(div);
  messagesArea.scrollTop = messagesArea.scrollHeight;
  return div;
}

function removeTyping() {
  $('typingIndicator')?.remove();
}

// ===== SEND MESSAGE =====
async function sendMessage(content, images = [], isRegenerate = false) {
  if (state.isGenerating) return;
  if (!content.trim() && images.length === 0) return;

  // Ensure active chat
  if (!state.activeChatId) {
    const chat = createNewChat(
      content.substring(0, 30) || 'New Chat',
      null,
      CONFIG.defaultSystemPrompt
    );
    state.activeChatId = chat.id;
    welcomeScreen.style.display = 'none';
    messagesArea.classList.add('visible');
    messagesArea.innerHTML = '';
    currentChatName.textContent = chat.name;
    currentChatType.textContent = 'Personal';
    renderSidebar();
  }

  const chat = getActiveChat();
  if (!chat) return;

  const userMsg = {
    id: uuid(),
    role: 'user',
    content: content.trim(),
    images: images.map(i => i.dataUrl),
    timestamp: Date.now(),
  };

  chat.messages.push(userMsg);
  chat.updatedAt = Date.now();
  if (chat.messages.length === 1) {
    chat.name = content.substring(0, 35) || 'Chat';
    currentChatName.textContent = chat.name;
  }
  saveChats();
  renderMessage(userMsg);

  // Clear input
  userInput.value = '';
  autoResize();
  charCount.textContent = '0';
  state.pendingImages = [];
  imagePreviewStrip.style.display = 'none';
  imagePreviewStrip.innerHTML = '';

  state.isGenerating = true;
  sendBtn.disabled = true;

  // Build API messages
  const apiMessages = chat.messages.slice(-20).map(m => ({
    role: m.role,
    content: m.content,
  }));

  const typingEl = showTyping();

  // Check if has images - use analyze-image endpoint
  if (images.length > 0) {
    const img = images[0];
    try {
      const res = await fetch(`${CONFIG.backendUrl}/api/analyze-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: img.base64,
          mimeType: img.mimeType,
          prompt: content.trim() || 'Analyze this image in detail.'
        })
      });
      const data = await res.json();
      removeTyping();
      finishAIMessage(data.text || data.error || 'Error analyzing image.', chat);
    } catch (err) {
      removeTyping();
      finishAIMessage('❌ Failed to connect to backend. Make sure the backend server is running.', chat);
    }
  } else {
    // Non-streaming - reliable on all hosting platforms
    try {
      const res = await fetch(CONFIG.backendUrl + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          model: document.getElementById('modelSelector').value,
          systemInstruction: chat.systemPrompt || CONFIG.defaultSystemPrompt
        })
      });
      removeTyping();
      if (!res.ok) {
        const errText = await res.text();
        finishAIMessage('❌ Server error ' + res.status + ': ' + errText, chat);
      } else {
        const data = await res.json();
        finishAIMessage(data.text || '(empty response — try again)', chat);
      }
    } catch (err) {
      removeTyping();
      console.error('Chat error:', err);
      finishAIMessage('❌ Network error: ' + err.message, chat);
    }
  }

  state.isGenerating = false;
  sendBtn.disabled = false;
}

function finishAIMessage(text, chat) {
  const aiMsg = { id: uuid(), role: 'assistant', content: text, timestamp: Date.now() };
  chat.messages.push(aiMsg);
  saveChats();
  renderMessage(aiMsg);
  renderSidebar();
}

// ===== PROJECT OPERATIONS =====
function openProjectChat(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;

  // Find or create chat for project
  let chat = state.chats.find(c => c.id === project.chatId);
  if (!chat) {
    chat = createNewChat(project.name, project.color, project.context || CONFIG.defaultSystemPrompt, project.id);
    project.chatId = chat.id;
    saveProjects();
  }

  loadChat(chat.id);
}

window.deleteProject = function(e, id) {
  e.stopPropagation();
  if (!confirm('Delete this project?')) return;
  const project = state.projects.find(p => p.id === id);
  if (project?.chatId) {
    state.chats = state.chats.filter(c => c.id !== project.chatId);
    saveChats();
  }
  state.projects = state.projects.filter(p => p.id !== id);
  saveProjects();
  if (state.activeChatId === project?.chatId) showWelcome();
  else renderSidebar();
  showToast('Project deleted', 'info');
};

window.deleteChat = function(e, id) {
  e.stopPropagation();
  state.chats = state.chats.filter(c => c.id !== id);
  saveChats();
  if (state.activeChatId === id) showWelcome();
  else renderSidebar();
  showToast('Chat deleted');
};

// ===== API STATUS CHECK =====
async function checkApiStatus() {
  try {
    const res = await fetch(`${CONFIG.backendUrl}/`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      statusDot.className = 'status-dot online';
      statusDot.title = 'Backend connected';
    } else throw new Error();
  } catch {
    statusDot.className = 'status-dot error';
    statusDot.title = 'Backend offline - check settings';
  }
}

// ===== IMAGE HANDLING =====
function handleImages(files) {
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      state.pendingImages.push({ dataUrl, base64, mimeType: file.type, name: file.name });
      updateImagePreview();
    };
    reader.readAsDataURL(file);
  });
}

function updateImagePreview() {
  if (state.pendingImages.length === 0) {
    imagePreviewStrip.style.display = 'none';
    imagePreviewStrip.innerHTML = '';
    return;
  }
  imagePreviewStrip.style.display = 'flex';
  imagePreviewStrip.innerHTML = state.pendingImages.map((img, i) => `
    <div class="preview-thumb">
      <img src="${img.dataUrl}" alt="${img.name}"/>
      <button class="preview-remove" onclick="removeImage(${i})">✕</button>
    </div>
  `).join('');
}

window.removeImage = function(i) {
  state.pendingImages.splice(i, 1);
  updateImagePreview();
};

// ===== AUTO RESIZE TEXTAREA =====
function autoResize() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 200) + 'px';
}

// ===== EXPORT =====
function exportHistory() {
  const data = {
    exported: new Date().toISOString(),
    user: CONFIG.userName,
    chats: state.chats,
    projects: state.projects,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rajashekar-ai-export-${Date.now()}.json`;
  a.click();
  showToast('Exported successfully!', 'success');
}

// ===== MODAL HELPERS =====
function openModal(id) {
  $(id).classList.add('open');
}
function closeModal(id) {
  $(id).classList.remove('open');
}

// ===== EVENT LISTENERS =====

// Send button
sendBtn.addEventListener('click', () => {
  sendMessage(userInput.value, state.pendingImages);
});

// Enter key
userInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(userInput.value, state.pendingImages);
  }
});

// Input auto-resize & char count
userInput.addEventListener('input', () => {
  autoResize();
  charCount.textContent = userInput.value.length;
});

// Hamburger sidebar toggle
$('hamburgerBtn').addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('open');
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
      });
      document.body.appendChild(overlay);
    }
    overlay.classList.toggle('active');
  } else {
    sidebar.classList.toggle('collapsed');
  }
});

$('sidebarClose').addEventListener('click', () => {
  sidebar.classList.add('collapsed');
});

// New chat
$('newChatBtn').addEventListener('click', () => {
  const chat = createNewChat('New Chat');
  state.activeChatId = chat.id;
  welcomeScreen.style.display = 'none';
  messagesArea.classList.add('visible');
  messagesArea.innerHTML = '';
  currentChatName.textContent = 'New Chat';
  currentChatType.textContent = 'Personal';
  renderSidebar();
  userInput.focus();
  if (window.innerWidth <= 768) {
    sidebar.classList.remove('open');
    document.querySelector('.sidebar-overlay')?.classList.remove('active');
  }
});

// New group
$('newGroupBtn').addEventListener('click', () => openModal('groupModal'));

$('createGroupBtn').addEventListener('click', () => {
  const name = $('groupName').value.trim() || 'Group Chat';
  const systemPrompt = $('groupSystemPrompt').value.trim() || CONFIG.defaultSystemPrompt;
  const selectedColor = document.querySelector('.color-opt.selected')?.dataset.color || '#C4B5FD';

  const chat = createNewChat(name, selectedColor, systemPrompt);
  chat.type = 'group';
  saveChats();
  closeModal('groupModal');
  loadChat(chat.id);
  showToast(`Group "${name}" created!`, 'success');
  $('groupName').value = '';
  $('groupSystemPrompt').value = '';
});

// New project
$('newProjectBtn').addEventListener('click', () => openModal('projectModal'));

$('createProjectConfirmBtn').addEventListener('click', () => {
  const name = $('projectName').value.trim();
  if (!name) { showToast('Please enter a project name', 'error'); return; }
  const desc = $('projectDesc').value.trim();
  const context = $('projectContext').value.trim();

  const colors = ['#6EE7B7','#93C5FD','#FCA5A5','#FCD34D','#C4B5FD','#F9A8D4'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const project = {
    id: uuid(),
    name,
    description: desc,
    context: context ? `${context}\n\n${CONFIG.defaultSystemPrompt}` : CONFIG.defaultSystemPrompt,
    color,
    chatId: null,
    createdAt: Date.now(),
  };

  state.projects.push(project);
  saveProjects();
  closeModal('projectModal');
  openProjectChat(project.id);
  showToast(`Project "${name}" created!`, 'success');
  $('projectName').value = '';
  $('projectDesc').value = '';
  $('projectContext').value = '';
});

// Clear chat
$('clearChatBtn').addEventListener('click', () => {
  const chat = getActiveChat();
  if (!chat) return;
  if (!confirm('Clear all messages in this chat?')) return;
  chat.messages = [];
  saveChats();
  messagesArea.innerHTML = '';
  showToast('Chat cleared');
});

// Welcome cards
document.querySelectorAll('.wcard').forEach(card => {
  card.addEventListener('click', () => {
    const prompt = card.dataset.prompt;
    userInput.value = prompt;
    autoResize();
    charCount.textContent = prompt.length;
    userInput.focus();
  });
});

// Image upload
$('imageUploadBtn').addEventListener('click', () => $('imageInput').click());
$('imageInput').addEventListener('change', e => handleImages(e.target.files));

// Drag & drop
chatContainer.addEventListener('dragover', e => {
  e.preventDefault();
  chatContainer.style.outline = '2px dashed var(--accent)';
});
chatContainer.addEventListener('dragleave', () => {
  chatContainer.style.outline = '';
});
chatContainer.addEventListener('drop', e => {
  e.preventDefault();
  chatContainer.style.outline = '';
  if (e.dataTransfer.files.length) handleImages(e.dataTransfer.files);
});

// Stream toggle
$('streamToggle').addEventListener('click', () => {
  CONFIG.streaming = !CONFIG.streaming;
  $('streamToggle').classList.toggle('active', CONFIG.streaming);
  showToast(`Streaming ${CONFIG.streaming ? 'enabled' : 'disabled'}`);
});

// Export
$('exportBtn').addEventListener('click', exportHistory);

// Clear all history
$('clearHistoryBtn').addEventListener('click', () => {
  if (!confirm('Delete ALL chat history? This cannot be undone.')) return;
  state.chats = [];
  state.projects = [];
  saveChats();
  saveProjects();
  showWelcome();
  showToast('All history cleared');
});

// Settings
$('settingsBtn').addEventListener('click', () => {
  $('backendUrl').value = CONFIG.backendUrl;
  $('settingsName').value = CONFIG.userName;
  $('defaultSystemPrompt').value = CONFIG.defaultSystemPrompt;
  openModal('settingsModal');
});

$('saveSettingsBtn').addEventListener('click', () => {
  CONFIG.backendUrl = $('backendUrl').value.trim() || LOCAL_BACKEND;
  CONFIG.userName = $('settingsName').value.trim() || 'Elluri Rajashekar';
  CONFIG.defaultSystemPrompt = $('defaultSystemPrompt').value.trim() || 'You are a helpful AI assistant.';
  localStorage.setItem('raj_backend_url', CONFIG.backendUrl);
  localStorage.setItem('raj_username', CONFIG.userName);
  localStorage.setItem('raj_system_prompt', CONFIG.defaultSystemPrompt);
  closeModal('settingsModal');
  checkApiStatus();
  showToast('Settings saved!', 'success');
});

$('themeDark').addEventListener('click', () => {
  document.body.classList.remove('light');
  localStorage.setItem('raj_theme', 'dark');
  showToast('Dark theme applied');
});

$('themeLight').addEventListener('click', () => {
  document.body.classList.add('light');
  localStorage.setItem('raj_theme', 'light');
  showToast('Light theme applied');
});

// Modal close buttons
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// Color picker in group modal
document.querySelectorAll('.color-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.color-opt').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
  });
});

// Paste image
document.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  const imageItems = Array.from(items).filter(i => i.type.startsWith('image/'));
  if (imageItems.length) {
    const files = imageItems.map(i => i.getAsFile()).filter(Boolean);
    handleImages(files);
  }
});

// ===== INIT =====
function init() {
  // Apply saved theme
  const theme = localStorage.getItem('raj_theme');
  if (theme === 'light') document.body.classList.add('light');

  // Restore settings
  const savedUrl = localStorage.getItem('raj_backend_url');
  if (savedUrl) CONFIG.backendUrl = savedUrl;
  const savedName = localStorage.getItem('raj_username');
  if (savedName) CONFIG.userName = savedName;
  const savedPrompt = localStorage.getItem('raj_system_prompt');
  if (savedPrompt) CONFIG.defaultSystemPrompt = savedPrompt;

  renderSidebar();
  checkApiStatus();
  setInterval(checkApiStatus, 30000);

  // Auto-focus input
  userInput.focus();

  console.log(`
  ╔═══════════════════════════════╗
  ║   Rajashekar AI v1.0          ║
  ║   Data Intelligence Platform  ║
  ║   Backend: ${CONFIG.backendUrl} 
  ╚═══════════════════════════════╝
  `);
}

init();
