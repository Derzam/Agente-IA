export const RUNTIME_READINESS_PUBLIC = false as const;

export const RUNTIME_PRESENTATION = {
  openai: {
    status: 'Sin estado público de runtime',
    detail: 'El backend no publica todavía readiness, modelo, circuito o consumo para el panel.',
  },
  meta: {
    status: 'No verificado por endpoint público',
    detail: 'El backend no publica todavía readiness de credenciales, sandbox o proveedor para el panel.',
  },
  hosting: {
    status: 'No desplegado',
  },
} as const;
