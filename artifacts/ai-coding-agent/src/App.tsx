import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleStop,
  Code2,
  Copy,
  FileCode2,
  GitBranch,
  History,
  Layers3,
  Menu,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Sparkles,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

type MessageRole = 'user' | 'assistant';
type RunState = 'idle' | 'streaming' | 'stopped' | 'error';

type Message = {
  id: string;
  role: MessageRole;
  content: string;
};

const queryClient = new QueryClient();

const recentTasks = [
  { title: 'Add optimistic updates to…', time: '12 min ago', branch: 'feat/optimistic-ui' },
  { title: 'Investigate the auth callback', time: 'Yesterday', branch: 'fix/auth-callback' },
  { title: 'Refactor token refresh logic', time: 'Mar 14', branch: 'refactor/session' },
];

const starterPrompts = [
  {
    label: 'Trace a bug',
    prompt: 'Trace the source of the intermittent 401 after a session refresh. Show me where to look first and propose a focused fix.',
    icon: Terminal,
  },
  {
    label: 'Shape a feature',
    prompt: 'Design a small, production-ready approach for adding optimistic updates to the settings form. Include the key files and edge cases.',
    icon: Layers3,
  },
  {
    label: 'Review a diff',
    prompt: 'Review my current implementation for risky assumptions. Focus on error handling, race conditions, and the smallest useful improvements.',
    icon: FileCode2,
  },
];

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          className="rounded bg-[hsl(var(--secondary))] px-1.5 py-0.5 font-mono text-[.9em] text-[hsl(var(--foreground))]"
          key={`${part}-${index}`}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const nodes: ReactNode[] = [];
  let codeLines: string[] = [];
  let codeLanguage = '';
  let inCode = false;

  const pushCode = () => {
    if (codeLines.length === 0 && !codeLanguage) return;
    nodes.push(
      <div className="code-scroll my-4 overflow-x-auto rounded-xl border border-white/10 bg-[#202a35] shadow-[0_8px_24px_hsl(221_28%_17%/.12)]" key={`code-${nodes.length}`}>
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[.18em] text-[#9faeb5]">
          <span>{codeLanguage || 'code'}</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#bacf57]" /> readable</span>
        </div>
        <pre className="px-4 py-4 font-mono text-[12px] leading-6 text-[#e1e7e2]"><code>{codeLines.join('\n')}</code></pre>
      </div>,
    );
    codeLines = [];
    codeLanguage = '';
  };

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        pushCode();
        inCode = false;
      } else {
        inCode = true;
        codeLanguage = line.trim().slice(3).trim();
      }
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    if (!line.trim()) {
      nodes.push(<div className="h-2" key={`space-${index}`} />);
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      nodes.push(
        <h3 className="mb-2 mt-5 font-display text-[15px] font-bold tracking-[-.02em] text-[hsl(var(--foreground))]" key={`heading-${index}`}>
          {renderInline(heading[2])}
        </h3>,
      );
      return;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      nodes.push(
        <div className="flex gap-3 py-1 text-[13px] leading-6" key={`bullet-${index}`}>
          <span className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--accent))]" />
          <span>{renderInline(bullet[1])}</span>
        </div>,
      );
      return;
    }
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (numbered) {
      nodes.push(
        <div className="flex gap-3 py-1 text-[13px] leading-6" key={`number-${index}`}>
          <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">{line.trim().slice(0, 2)}</span>
          <span>{renderInline(numbered[1])}</span>
        </div>,
      );
      return;
    }
    nodes.push(<p className="text-[13px] leading-6 text-[hsl(var(--foreground)/.84)]" key={`paragraph-${index}`}>{renderInline(line)}</p>);
  });

  if (inCode) pushCode();
  return <div>{nodes}</div>;
}

function BrandMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[hsl(var(--accent))] text-[hsl(var(--primary))] shadow-[0_5px_15px_hsl(74_67%_45%/.2)]">
      <Code2 size={17} strokeWidth={2.6} />
    </div>
  );
}

function StatusBadge({ state }: { state: RunState }) {
  const labels: Record<RunState, string> = {
    idle: 'Ready',
    streaming: 'Generating',
    stopped: 'Stopped',
    error: 'Needs attention',
  };
  const dotClass: Record<RunState, string> = {
    idle: 'bg-[hsl(var(--muted-foreground))]',
    streaming: 'bg-[hsl(var(--accent))] shadow-[0_0_0_3px_hsl(74_67%_62%/.14)]',
    stopped: 'bg-[hsl(var(--chart-4))]',
    error: 'bg-[hsl(var(--destructive))]',
  };
  return (
    <div className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.58)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]" data-testid="status-run">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass[state]}`} />
      {labels[state]}
    </div>
  );
}

function SideRail({
  mobileOpen,
  onClose,
  onNew,
  onSelectTask,
}: {
  mobileOpen: boolean;
  onClose: () => void;
  onNew: () => void;
  onSelectTask: (prompt: string) => void;
}) {
  return (
    <>
      {mobileOpen && <button className="fixed inset-0 z-30 bg-[hsl(var(--primary)/.34)] md:hidden" onClick={onClose} aria-label="Close navigation" data-testid="button-close-navigation" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[276px] flex-col border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] transition-transform duration-300 md:static md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-[72px] items-center justify-between border-b border-[hsl(var(--sidebar-border))] px-5">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <div className="font-display text-[14px] font-bold tracking-[-.02em]">Patchwork</div>
              <div className="font-mono text-[9px] uppercase tracking-[.18em] text-[hsl(var(--sidebar-foreground)/.48)]">AI coding agent</div>
            </div>
          </div>
          <button className="rounded-lg p-1.5 text-[hsl(var(--sidebar-foreground)/.6)] hover:bg-[hsl(var(--sidebar-accent))] md:hidden" onClick={onClose} aria-label="Close navigation" data-testid="button-close-navigation-mobile"><X size={16} /></button>
        </div>

        <div className="p-4">
          <button className="flex w-full items-center justify-between rounded-xl bg-[hsl(var(--sidebar-primary))] px-3.5 py-3 text-left text-[12px] font-bold text-[hsl(var(--sidebar-primary-foreground))] transition-transform hover:-translate-y-0.5 active:translate-y-0" onClick={onNew} data-testid="button-new-task">
            <span className="flex items-center gap-2"><Plus size={15} strokeWidth={2.5} /> New task</span>
            <span className="font-mono text-[10px] opacity-55">⌘ N</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4">
          <div className="mb-3 flex items-center gap-2 px-2 font-mono text-[9px] uppercase tracking-[.18em] text-[hsl(var(--sidebar-foreground)/.4)]">
            <History size={12} /> Recent work
          </div>
          <div className="space-y-1">
            {recentTasks.map((task, index) => (
              <button
                className="group w-full rounded-xl px-2.5 py-3 text-left transition-colors hover:bg-[hsl(var(--sidebar-accent))]"
                key={task.title}
                onClick={() => onSelectTask(`Continue this task: ${task.title.replace('…', '')}. Inspect the relevant code and explain the next precise step.`)}
                data-testid={`button-recent-task-${index}`}
              >
                <div className="truncate text-[11px] font-medium text-[hsl(var(--sidebar-foreground)/.8)] group-hover:text-[hsl(var(--sidebar-foreground))]">{task.title}</div>
                <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[9px] text-[hsl(var(--sidebar-foreground)/.35)]">
                  <span>{task.time}</span><span className="truncate">{task.branch}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="my-6 h-px bg-[hsl(var(--sidebar-border))]" />
          <div className="mb-3 px-2 font-mono text-[9px] uppercase tracking-[.18em] text-[hsl(var(--sidebar-foreground)/.4)]">Workspace</div>
          <button className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left text-[11px] text-[hsl(var(--sidebar-foreground)/.62)] transition-colors hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]" data-testid="button-current-workspace">
            <GitBranch size={14} /> <span className="truncate">northstar / web-app</span>
            <ChevronDown className="ml-auto" size={13} />
          </button>
        </div>

        <div className="border-t border-[hsl(var(--sidebar-border))] p-4">
          <div className="flex items-center gap-3 rounded-xl bg-[hsl(var(--sidebar-accent)/.6)] p-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--sidebar-primary)/.18)] font-mono text-[10px] font-bold text-[hsl(var(--sidebar-primary))]">JD</div>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold">Jordan Davis</div>
              <div className="font-mono text-[9px] text-[hsl(var(--sidebar-foreground)/.4)]">Personal workspace</div>
            </div>
            <MoreHorizontal className="ml-auto text-[hsl(var(--sidebar-foreground)/.45)]" size={15} />
          </div>
        </div>
      </aside>
    </>
  );
}

function EmptyWorkspace({ onPrompt }: { onPrompt: (prompt: string) => void }) {
  return (
    <div className="agent-rise flex flex-1 flex-col items-center justify-center px-5 pb-10 pt-16 text-center">
      <div className="mb-7 flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.58)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.17em] text-[hsl(var(--muted-foreground))]">
        <Sparkles size={12} className="text-[hsl(var(--chart-4))]" /> context-aware assistance
      </div>
      <h1 className="max-w-[680px] font-display text-4xl font-bold leading-[1.05] tracking-[-.055em] text-[hsl(var(--foreground))] sm:text-5xl">
        Make the next change<br /><span className="text-[hsl(var(--muted-foreground)/.56)]">the right one.</span>
      </h1>
      <p className="mt-5 max-w-[510px] text-sm leading-6 text-[hsl(var(--muted-foreground))]">
        Describe what you are building, fixing, or reviewing. Patchwork will reason through the codebase with you, one useful step at a time.
      </p>
      <div className="mt-10 grid w-full max-w-[700px] gap-3 sm:grid-cols-3">
        {starterPrompts.map((item, index) => {
          const Icon = item.icon;
          return (
            <button className="agent-rise group rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/.62)] p-4 text-left transition-all hover:-translate-y-1 hover:border-[hsl(var(--accent)/.7)] hover:bg-[hsl(var(--card))] hover:shadow-[0_10px_24px_hsl(221_28%_17%/.08)]" style={{ animationDelay: `${index * 70 + 120}ms` }} key={item.label} onClick={() => onPrompt(item.prompt)} data-testid={`button-starter-${index}`}>
              <span className="mb-8 flex h-7 w-7 items-center justify-center rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] transition-colors group-hover:bg-[hsl(var(--accent))] group-hover:text-[hsl(var(--accent-foreground))]"><Icon size={14} /></span>
              <span className="block text-[12px] font-bold text-[hsl(var(--foreground))]">{item.label}</span>
              <span className="mt-1 block text-[10px] leading-4 text-[hsl(var(--muted-foreground))]">{item.prompt.slice(0, 48)}…</span>
            </button>
          );
        })}
      </div>
      <div className="mt-10 flex items-center gap-5 font-mono text-[9px] uppercase tracking-[.12em] text-[hsl(var(--muted-foreground)/.7)]">
        <span className="flex items-center gap-1.5"><Zap size={11} className="text-[hsl(var(--chart-4))]" /> streams live</span>
        <span className="flex items-center gap-1.5"><Check size={11} className="text-[hsl(var(--chart-2))]" /> markdown ready</span>
      </div>
    </div>
  );
}

function MessageView({ message, onCopy }: { message: Message; onCopy: (content: string) => void }) {
  const isUser = message.role === 'user';
  return (
    <div className={`agent-rise flex gap-3 sm:gap-4 ${isUser ? 'justify-end' : 'justify-start'}`} data-testid={`message-${message.role}-${message.id}`}>
      {!isUser && <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[hsl(var(--primary))] text-[hsl(var(--accent))]"><Code2 size={14} /></div>}
      <div className={`max-w-[min(760px,88%)] ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`mb-1.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.16em] ${isUser ? 'justify-end text-[hsl(var(--muted-foreground))]' : 'text-[hsl(var(--muted-foreground))]'}`}>
          <span>{isUser ? 'You' : 'Patchwork'}</span>
          {!isUser && <span className="h-1 w-1 rounded-full bg-[hsl(var(--accent))]" />}
        </div>
        <div className={`rounded-2xl px-4 py-3.5 ${isUser ? 'rounded-tr-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'rounded-tl-md border border-[hsl(var(--border))] bg-[hsl(var(--card)/.76)]'}`}>
          {message.content ? <MarkdownContent content={message.content} /> : <div className="flex items-center gap-1.5 py-2" data-testid="loading-assistant"><span className="typing-dot h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /><span className="typing-dot h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /><span className="typing-dot h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" /></div>}
        </div>
        {!isUser && message.content && (
          <button className="mt-2 flex items-center gap-1.5 px-1 text-[10px] text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]" onClick={() => onCopy(message.content)} data-testid={`button-copy-${message.id}`}><Copy size={11} /> Copy response</button>
        )}
      </div>
    </div>
  );
}

function PromptComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  state,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  state: RunState;
}) {
  const canSubmit = value.trim().length > 0 && state !== 'streaming';
  return (
    <div className="mx-auto w-full max-w-[850px]">
      <form onSubmit={(event) => { event.preventDefault(); if (canSubmit) onSubmit(); }} className={`relative rounded-2xl border bg-[hsl(var(--card)/.87)] p-2 shadow-[0_10px_35px_hsl(221_28%_17%/.08)] transition-all focus-within:border-[hsl(var(--accent)/.9)] focus-within:shadow-[0_12px_36px_hsl(74_67%_45%/.12)] ${state === 'streaming' ? 'border-[hsl(var(--accent)/.65)]' : 'border-[hsl(var(--border))]'}`}>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (canSubmit) onSubmit(); } }}
          placeholder="Describe a change, ask about the code, or paste an error…"
          className="min-h-[76px] w-full resize-none bg-transparent px-3 py-2 text-[13px] leading-6 text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground)/.74)]"
          aria-label="Describe a coding task"
          data-testid="input-task-prompt"
        />
        <div className="flex items-center justify-between border-t border-[hsl(var(--border)/.65)] px-2 pt-2">
          <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))]">
            <span className="hidden sm:inline">Shift + Enter for newline</span>
            <span className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${state === 'streaming' ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--chart-2))]'}`} /> {state === 'streaming' ? 'Live stream' : 'Ready to run'}</span>
          </div>
          {state === 'streaming' ? (
            <button type="button" onClick={onStop} className="flex h-9 items-center gap-2 rounded-xl bg-[hsl(var(--secondary))] px-3 text-[11px] font-bold text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--border))]" data-testid="button-stop-generation"><CircleStop size={15} /> Stop</button>
          ) : (
            <button type="submit" disabled={!canSubmit} className="flex h-9 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3.5 text-[11px] font-bold text-[hsl(var(--primary-foreground))] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_16px_hsl(221_28%_17%/.18)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0" data-testid="button-submit-task"><ArrowUp size={15} strokeWidth={2.5} /> Run task</button>
          )}
        </div>
      </form>
      <div className="mt-3 flex items-center justify-center gap-1.5 text-center font-mono text-[9px] text-[hsl(var(--muted-foreground)/.7)]"><span>Patchwork can make mistakes.</span><span className="h-1 w-1 rounded-full bg-[hsl(var(--border))]" /><span>Review changes before shipping.</span></div>
    </div>
  );
}

function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [runState, setRunState] = useState<RunState>('idle');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const responseRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowStreamRef = useRef(true);

  useEffect(() => {
    const responseElement = responseRef.current;
    if (!responseElement || !shouldFollowStreamRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      responseElement.scrollTop = responseElement.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  const copyResponse = async (content: string) => {
    try { await navigator.clipboard.writeText(content); } catch { /* clipboard can be unavailable in preview */ }
  };

  const startTask = async () => {
    const content = prompt.trim();
    if (!content || runState === 'streaming') return;
    const userMessage: Message = { id: `user-${Date.now()}`, role: 'user', content };
    const assistantId = `assistant-${Date.now()}`;
    const assistantMessage: Message = { id: assistantId, role: 'assistant', content: '' };
    const requestMessages = [...messages, userMessage];
    shouldFollowStreamRef.current = true;
    setMessages([...requestMessages, assistantMessage]);
    setPrompt('');
    setRunState('streaming');

    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    abortRef.current = controller;
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ messages: requestMessages.map(({ role, content: messageContent }) => ({ role, content: messageContent })) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      if (!response.body) throw new Error('The stream was unavailable.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      let streamError = false;
      const appendChunk = (chunk: string) => {
        if (!chunk) return;
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + chunk } : message));
      };
      const parseEvent = (raw: string) => {
        const data = raw.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (!data) return;
        try {
          const payload = JSON.parse(data) as { content?: string; done?: boolean; error?: string };
          if (payload.content) appendChunk(payload.content);
          if (payload.done) finished = true;
          if (payload.error) {
            streamError = true;
            finished = true;
          }
        } catch { /* ignore an incomplete event; the reader will provide the rest */ }
      };
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        events.forEach(parseEvent);
      }
      if (buffer.trim()) parseEvent(buffer);
      if (requestIdRef.current === requestId) {
        if (streamError) {
          setRunState('error');
          setMessages((current) => current.map((message) => message.id === assistantId
            ? { ...message, content: message.content || 'Gemini could not complete this request. Please try again.' }
            : message));
        } else {
          setRunState('idle');
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (requestIdRef.current === requestId) setRunState('stopped');
      } else {
        if (requestIdRef.current === requestId) {
          setRunState('error');
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content || 'I could not reach the coding stream. Check the API server and try again.' } : message));
        }
      }
    } finally {
      if (requestIdRef.current === requestId) abortRef.current = null;
    }
  };

  const stopTask = () => {
    abortRef.current?.abort();
  };

  const resetWorkspace = () => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    setMessages([]);
    setPrompt('');
    setRunState('idle');
    shouldFollowStreamRef.current = true;
    setMobileNavOpen(false);
  };

  const choosePrompt = (value: string) => {
    setPrompt(value);
    setMobileNavOpen(false);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-testid="input-task-prompt"]')?.focus(), 0);
  };

  return (
    <div className="agent-shell relative flex min-h-[100dvh] overflow-hidden text-[hsl(var(--foreground))]">
      <div className="agent-grid pointer-events-none absolute inset-0 opacity-80" />
      <SideRail mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} onNew={resetWorkspace} onSelectTask={choosePrompt} />
      <main className="relative flex min-h-[100dvh] min-w-0 flex-1 flex-col">
        <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-[hsl(var(--border)/.8)] px-4 sm:px-7">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] md:hidden" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={19} /></button>
            <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))] sm:flex"><span className="text-[hsl(var(--foreground)/.8)]">Workspace</span><span>/</span><span>New task</span></div>
            <div className="flex items-center gap-2 sm:hidden"><BrandMark /><span className="font-display text-[13px] font-bold">Patchwork</span></div>
          </div>
          <div className="flex items-center gap-2.5"><StatusBadge state={runState} /><button className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]" onClick={resetWorkspace} aria-label="Reset workspace" data-testid="button-reset-workspace"><RotateCcw size={15} /></button></div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {messages.length === 0 ? <EmptyWorkspace onPrompt={choosePrompt} /> : (
             <div
               className="flex-1 overflow-y-auto px-4 py-8 sm:px-8 sm:py-10"
               ref={responseRef}
               onScroll={(event) => {
                 const element = event.currentTarget;
                 shouldFollowStreamRef.current =
                   element.scrollHeight - element.scrollTop - element.clientHeight < 96;
               }}
             >
              <div className="mx-auto flex max-w-[850px] flex-col gap-8">
                <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]"><span className="h-px flex-1 bg-[hsl(var(--border))]" /><span>Task transcript</span><span className="h-px flex-1 bg-[hsl(var(--border))]" /></div>
                {messages.map((message) => <MessageView key={message.id} message={message} onCopy={copyResponse} />)}
                {runState === 'error' && <div className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--destructive)/.28)] bg-[hsl(var(--destructive)/.07)] px-3.5 py-3 text-[11px] text-[hsl(var(--destructive))]" data-testid="status-error"><span>Something interrupted the stream. Your prompt is still here.</span><button className="font-bold underline underline-offset-2" onClick={() => setPrompt(messages.findLast((message) => message.role === 'user')?.content ?? '')} data-testid="button-retry-task">Retry</button></div>}
                {runState === 'stopped' && <div className="flex items-center gap-2 rounded-xl border border-[hsl(var(--chart-4)/.28)] bg-[hsl(var(--chart-4)/.08)] px-3.5 py-3 font-mono text-[10px] uppercase tracking-[.08em] text-[hsl(var(--foreground)/.72)]" data-testid="status-stopped"><CircleStop size={13} className="text-[hsl(var(--chart-4))]" /> Generation stopped. Continue with a new instruction below.</div>}
              </div>
            </div>
          )}
          <div className="shrink-0 px-4 pb-5 pt-3 sm:px-8 sm:pb-7"><PromptComposer value={prompt} onChange={setPrompt} onSubmit={startTask} onStop={stopTask} state={runState} /></div>
        </div>
      </main>
    </div>
  );
}

function Router() {
  return (
    <ErrorBoundary resetKey={useLocation()[0]}>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;