/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Endereço da API quando as telas ficam num site separado (ex.: https://api.seudominio.com.br). Vazio = mesmo endereço. */
  readonly VITE_API_URL?: string;
}
