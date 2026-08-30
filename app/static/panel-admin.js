  async function vimovePanel(sb) {
    async function count(table, col, val) {
      try {
        let q = sb.from(table).select("id", { count: "exact", head: true });
        if (col) q = q.eq(col, val);
        const { count } = await q; return typeof count === "number" ? count : 0;
      } catch (e) { return 0; }
    }
    document.getElementById("statUzman").textContent = await count("profiles", "role", "uzman");
    document.getElementById("statHasta").textContent = await count("profiles", "role", "hasta");
    document.getElementById("statSeans").textContent = await count("sessions");
    document.getElementById("statRecete").textContent = await count("prescriptions");
    try {
      const { data } = await sb.from("profiles").select("id,full_name,title").eq("role", "uzman").limit(50);
      if (data && data.length) {
        document.getElementById("uzmanRows").innerHTML = data.map(function (u) {
          const name = (u.full_name || "—");
          const ini = name.trim().slice(0, 2).toUpperCase() || "?";
          return '<tr><td><span class="pt-name"><span class="pt-ini">' + ini + '</span>' + name + '</span></td>' +
            '<td>' + (u.title || "—") + '</td><td>—</td><td><span class="pill ok">Aktif</span></td></tr>';
        }).join("");
      }
    } catch (e) {}
  }
  (function () {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (window.vimovePanelCtx) {
        clearInterval(timer);
        Promise.resolve(vimovePanel(window.vimovePanelCtx.sb)).catch(function (e) { console.error("panel init:", e); });
      } else if (tries > 120) { clearInterval(timer); }
    }, 100);
  })();
