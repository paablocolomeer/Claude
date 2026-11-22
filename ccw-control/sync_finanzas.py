#!/usr/bin/env python3
"""CCW Control · pasa las finanzas del "Excel Financiero CCW" a la fila base.

Uso: python3 -I sync_finanzas.py <excel.xlsx> <base_actual.json> <base_nueva.json>

- Gastos ("Hoja de Gastos") -> movimientos, con la categoría del panel según las reglas de abajo.
- Ingresos ("Hoja de Ingresos") -> entradas brutas/netas y número de liquidaciones por mes.
- Meses: se recalculan enteros desde el Excel, desde el primer mes con datos hasta el mes en curso.
- Solo toca movimientos, meses, rango_datos y notas_finanzas.actualizado; el resto de la fila base queda igual.
- Imprime "OK ·" con los movimientos nuevos y quitados respecto a la base anterior. Una categoría que no
  encaje en ninguna regla para el script (código 2) para que se decida a mano antes de escribir nada.
"""
import json
import sys
from collections import defaultdict
from datetime import date, datetime

import openpyxl

CATS = ["marketing", "material", "otros", "seguro", "sueldos", "trabajadores", "web"]
# Inversiones que se amortizan en devengo (meses): por palabras del concepto
AMORT = [("buzón", 60), ("buzones", 60), ("pago web", 36), ("conexión web", 36), ("desarrollo", 36)]


def categoria(concepto: str, tag: str, cuenta: str) -> str | None:
    c, t, k = concepto.lower(), (tag or "").lower(), (cuenta or "").lower()
    if "seguro" in k or "seguro" in c:
        return "seguro"
    if "nómina" in c or "nomina" in c or "seguridad social" in c or "sueldos" in k:
        return "sueldos"
    if "zancus" in c or "nataly" in c or "trabajador" in t and "material" not in t:
        return "trabajadores"
    if "páginas web" in k or "paginas web" in k or "stripe" in c or "holded" in c or "hostinger" in c or "ionos" in c:
        return "web"
    if t == "fiscalidad" or "notar" in c or "certificado" in c or c == "sim":
        return "otros"
    if any(w in c for w in ["buzón", "buzones", "vinilo", "roll-up", "tarjetas", "taquilla", "rectificativa", "imprimir"]):
        return "marketing"
    if "colibr" in c or t in ("lavados", "productos lavados", "ontier", "los cubos", "material trabajadores") or "productos" in c \
            or any(w in c for w in ["trapos", "cepillo", "aspiradora", "ech20", "material", "taburete", "textil"]):
        return "material"
    return None


def amort(concepto: str, importe: float) -> int:
    # solo inversiones grandes (buzones, desarrollo de la web); vinilos y compras pequeñas van al mes
    if importe < 200:
        return 0
    c = concepto.lower()
    for w, n in AMORT:
        if w in c:
            return n
    return 0


def main(xlsx: str, base_in: str, base_out: str) -> int:
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    base = json.load(open(base_in, encoding="utf-8"))
    norm = lambda f: datetime.strptime(f, "%d/%m/%Y").strftime("%d/%m/%Y")
    antes = {(norm(m["fecha"]), m["concepto"], m["importe"]) for m in base.get("movimientos", [])}
    previos = {(norm(m["fecha"]), m["concepto"].strip().lower()): m for m in base.get("movimientos", [])}

    movs, dudas = [], []
    for r in wb["Hoja de Gastos"].iter_rows(min_row=2, values_only=True):
        # "Gasto" o "Ingreso" (devoluciones y rectificativas, con importe negativo en la columna de gasto)
        if isinstance(r[2], datetime) and r[5] is None and str(r[7]).strip().lower() == "pendiente":
            # factura pendiente sin importe en el Excel (p. ej. las de El Colibrí): se conserva la del panel si la había
            prev = previos.get((f"{r[2]:%d/%m/%Y}", str(r[3]).strip().lower()))
            if prev and not prev["pagado"]:
                movs.append({**prev, "fecha": f"{r[2]:%d/%m/%Y}"})
            continue
        if not isinstance(r[2], datetime) or r[5] is None or str(r[0]).strip().lower() not in ("gasto", "ingreso"):
            continue
        concepto, tag, importe = str(r[3]).strip(), str(r[4] or "").strip(), round(float(r[5]), 2)
        cuenta = str(r[9] or "").strip()
        cat = categoria(concepto, tag, cuenta)
        if cat is None:
            dudas.append(f"{r[2]:%d/%m/%Y} {concepto} ({tag}, {cuenta}) {importe}")
            continue
        movs.append({"amort_meses": amort(concepto, importe) if cat in ("web", "marketing") else 0, "categoria": cat, "concepto": concepto,
                     "cuenta": cuenta, "factura": str(r[8] or "").strip(), "fecha": f"{r[2]:%d/%m/%Y}", "importe": importe,
                     "m": f"{r[2]:%Y-%m}", "pagado": str(r[7]).strip().lower() == "pagado", "tag": tag})
    if dudas:
        print("DUDA · gastos sin categoría clara (no se ha escrito nada):\n  " + "\n  ".join(dudas))
        return 2
    movs.sort(key=lambda m: datetime.strptime(m["fecha"], "%d/%m/%Y"))

    ing = defaultdict(lambda: {"bruto": 0.0, "neto": 0.0, "n": 0})
    for r in wb["Hoja de Ingresos"].iter_rows(min_row=2, values_only=True):
        if not isinstance(r[0], datetime) or r[5] is None:
            continue
        g = ing[f"{r[0]:%Y-%m}"]
        g["bruto"] += float(r[5]); g["neto"] += float(r[9] if r[9] is not None else r[7]); g["n"] += 1

    hoy = date.today().strftime("%Y-%m")
    primero = min([m["m"] for m in movs] + list(ing))
    meses, (y, mo) = [], map(int, primero.split("-"))
    while True:
        k = f"{y:04d}-{mo:02d}"
        fila = {c: 0.0 for c in CATS}
        fila["colibri_pendiente"] = 0.0
        for m in movs:
            if m["m"] != k:
                continue
            if m["pagado"]:
                fila[m["categoria"]] += m["importe"]
            elif "colibr" in m["concepto"].lower():
                fila["colibri_pendiente"] += m["importe"]
        fila = {c: round(v, 2) for c, v in fila.items()}
        g = ing.get(k, {"bruto": 0, "neto": 0, "n": 0})
        fila.update({"m": k, "entradas_bruto": round(g["bruto"], 2), "entradas_neto": round(g["neto"], 2), "payouts": g["n"], "partial": k == hoy})
        meses.append(dict(sorted(fila.items())))
        if k >= hoy:
            break
        mo += 1
        if mo == 13:
            mo, y = 1, y + 1

    base["movimientos"], base["meses"] = movs, meses
    base["rango_datos"] = {**base.get("rango_datos", {}), "desde": primero, "hasta": hoy}
    base.setdefault("notas_finanzas", {})["actualizado"] = date.today().isoformat()
    json.dump(base, open(base_out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    ahora = {(m["fecha"], m["concepto"], m["importe"]) for m in movs}
    nuevos, quitados = sorted(ahora - antes), sorted(antes - ahora)
    print(f"OK · {len(movs)} gastos, {sum(g['n'] for g in ing.values())} liquidaciones, {len(meses)} meses · "
          f"{len(nuevos)} gastos nuevos, {len(quitados)} quitados")
    for n in nuevos:
        print("  + " + " · ".join(map(str, n)))
    for q in quitados:
        print("  - " + " · ".join(map(str, q)))
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:4]))
