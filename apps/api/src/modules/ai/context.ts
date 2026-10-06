export function minimizedText(text: string) {
  return text
    .slice(0, 2000)
    .replace(/confirm:[a-f0-9-]+:[A-Za-z0-9:_-]+/gi, "[confirmation]")
    .replace(/Bearer\s+\S+/gi, "[credential]")
    .replace(/\+?\d[\d ()-]{6,}\d/g, "[phone]")
    .replace(/(?:sk-|EA[A-Za-z0-9])[A-Za-z0-9_-]{16,}/g, "[credential]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[opaque]");
}
export const safeUtterances = [
  "¿Qué producto y cantidad deseas pedir?",
  "¿Prefieres recoger el pedido o recibirlo a domicilio?",
  "¿Puedes aclarar tu solicitud?",
  "Indica la dirección y ubicación únicamente si deseas entrega a domicilio.",
];
export function renderTool(name: string, result: any): string | null {
  const format = (p: any) =>
    `${p.name}: ${p.currency} ${(p.price_minor / 100).toFixed(2)}`;
  if (name === "search_menu" && Array.isArray(result))
    return result.length
      ? result.map(format).join("\n").slice(0, 1800)
      : "No encontré productos disponibles con esa búsqueda.";
  if (name === "get_product" && result?.name)
    return format(result) + (result.available ? "" : " (no disponible)");
  if (
    ["add_to_cart", "remove_from_cart", "set_fulfillment", "get_cart"].includes(
      name,
    )
  )
    return "Carrito actualizado. Solicita una cotización para revisar los importes y confirmar con el botón.";
  if (name === "confirm_order" && result?.status === "confirmed")
    return "Pedido confirmado mediante tu selección interactiva. El pago continúa pendiente.";
  return null;
}
import type { Turn } from "./ports.js";
import type { InputItem } from "./provider.js";
import { instructions } from "./instructions.js";
export function buildContext(turn: Turn): InputItem[] {
  return [
    {
      role: "developer",
      content:
        instructions +
        " Usa únicamente estas frases de aclaración: " +
        safeUtterances.join(" | "),
    },
    ...(turn.prior
      ? [{ role: "assistant" as const, content: turn.prior }]
      : []),
    { role: "user", content: turn.text },
  ];
}
