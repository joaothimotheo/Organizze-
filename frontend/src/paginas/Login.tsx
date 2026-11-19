import { useState, type FormEvent } from "react";
import { api, urlApi, type MetodosLogin } from "../api";

/** Motivos que o back-end devolve em `/?login=<motivo>` quando o login com Google não dá certo. */
const MOTIVOS: Record<string, string> = {
  negado: "Esta conta do Google não tem acesso. Entre com o e-mail cadastrado no sistema.",
  cancelado: "O login com o Google foi cancelado.",
  expirado: "O login demorou demais ou foi aberto em outra aba. Tente de novo.",
  falhou: "Não consegui confirmar o login com o Google. Tente de novo em instantes.",
  indisponivel: "O login com o Google não está configurado neste servidor.",
};

/** Lê `?login=` uma vez e limpa o endereço, para a mensagem não voltar ao recarregar. */
function motivoDoEndereco(): string | null {
  const p = new URLSearchParams(location.search);
  const m = p.get("login");
  if (m === null) return null;
  p.delete("login");
  const resto = p.toString();
  history.replaceState(null, "", location.pathname + (resto ? `?${resto}` : "") + location.hash);
  return MOTIVOS[m] ?? MOTIVOS.falhou;
}

function IconeGoogle() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function Login({ metodos, aoEntrar }: { metodos: MetodosLogin; aoEntrar: () => void }) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(motivoDoEndereco);
  const [enviando, setEnviando] = useState(false);
  const [indoAoGoogle, setIndoAoGoogle] = useState(false);
  // Com o Google ligado, a senha fica guardada atrás de um link (acesso de emergência).
  const [mostrarSenha, setMostrarSenha] = useState(!metodos.google);

  async function entrar(ev: FormEvent) {
    ev.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      await api.entrar(usuario, senha);
      setSenha("");
      aoEntrar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login">
      <div className="panel login-card">
        <div className="brand">
          <div className="eyebrow">Gestão financeira pessoal</div>
          <h1>Financeiro</h1>
        </div>

        {metodos.google && (
          <a
            className="botao-google"
            href={urlApi("/api/auth/google")}
            aria-disabled={indoAoGoogle}
            onClick={() => {
              setErro(null);
              setIndoAoGoogle(true);
            }}
          >
            <IconeGoogle />
            {indoAoGoogle ? "Abrindo o Google…" : "Entrar com Google"}
          </a>
        )}

        {erro && <div className="erro">{erro}</div>}

        {metodos.senha && !mostrarSenha && (
          <button type="button" className="btn-link" onClick={() => setMostrarSenha(true)}>
            Entrar com usuário e senha
          </button>
        )}

        {metodos.senha && mostrarSenha && (
          <form className="login-form" onSubmit={entrar}>
            <div className="field">
              <label htmlFor="l-usuario">Usuário</label>
              <input id="l-usuario" type="text" autoComplete="username" autoCapitalize="none" value={usuario} onChange={(e) => setUsuario(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="l-senha">Senha deste sistema</label>
              <input id="l-senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
            </div>
            <button type="submit" className="primary" disabled={enviando}>
              {enviando ? "Entrando…" : "Entrar"}
            </button>
            <p className="note">Use a senha que você definiu ao publicar o sistema. Nunca a senha do banco.</p>
          </form>
        )}

        {metodos.google && <p className="note">Só o e-mail do Google cadastrado no sistema consegue entrar.</p>}
      </div>
    </div>
  );
}
