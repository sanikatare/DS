import { useState, useEffect, useCallback } from "react";
import PageShell from "../components/layout/PageShell";
import { fetchLedger, connectTransactionSocket } from "../api";
import {
  BookOpen,
  ShieldCheck,
  Building2,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  Download,
  Scale,
  Users,
} from "lucide-react";

const INR_FORMAT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function LedgerView() {
  const [ledgerData, setLedgerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connStatus, setConnStatus] = useState("connecting");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBank, setSelectedBank] = useState("ALL");
  const [selectedType, setSelectedType] = useState("ALL");

  const loadData = useCallback(async () => {
    try {
      const data = await fetchLedger();
      setLedgerData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const ws = connectTransactionSocket(() => loadData(), setConnStatus);
    const interval = setInterval(loadData, 4000);
    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [loadData]);

  const accounts = ledgerData?.accounts || [];
  const journalEntries = ledgerData?.journalEntries || [];
  const invariants = ledgerData?.invariants || {
    genesisSupply: 69000,
    currentTotalDeposits: 69000,
    isConservationPreserved: true,
    totalDebited: 0,
    totalCredited: 0,
    debitCreditParity: true,
  };
  const banks = ledgerData?.banks || [];

  const filteredEntries = journalEntries.filter((entry) => {
    const matchesSearch =
      searchTerm === "" ||
      entry.accountUpi.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.transactionId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.id.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesBank =
      selectedBank === "ALL" || entry.bank === selectedBank;

    const matchesType =
      selectedType === "ALL" || entry.entryType === selectedType;

    return matchesSearch && matchesBank && matchesType;
  });

  function exportCSV() {
    if (!journalEntries.length) return;
    const headers = ["Entry ID", "Transaction ID", "Timestamp", "Account UPI", "User Name", "Bank", "Type", "Amount", "Status", "Description"];
    const rows = journalEntries.map((e) => [
      e.id,
      e.transactionId,
      e.timestamp,
      e.accountUpi,
      e.userName,
      e.bank,
      e.entryType,
      e.amount,
      e.status,
      `"${e.description.replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `upi-ledger-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <PageShell connStatus={connStatus}>
      {/* Header Bar */}
      <div className="page-header">
        <div>
          <div
            className="unit-tag"
            style={{
              background: "var(--upi-green-tint)",
              color: "var(--upi-green)",
              borderColor: "var(--upi-green-border)",
            }}
          >
            Core Banking & Distributed Consensus
          </div>
          <h1 className="page-title">Distributed Multi-Bank Ledger</h1>
          <p className="page-subtitle">
            Cryptographically audited double-entry journal, real-time account balances across remitter and beneficiary core banking systems (CBS), and money conservation invariant verification.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={loadData}
            title="Refresh Ledger"
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            Sync Ledger
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={exportCSV}
            title="Export Ledger Journal as CSV"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Conservation of Money & Invariant Banner */}
      <div
        className="card-clean"
        style={{
          border: invariants.isConservationPreserved
            ? "1px solid var(--upi-green-border)"
            : "1px solid var(--crimson-border)",
          background: invariants.isConservationPreserved
            ? "var(--upi-green-tint)"
            : "var(--crimson-tint)",
          marginBottom: "20px",
          padding: "18px 24px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "50%",
                background: invariants.isConservationPreserved ? "var(--upi-green)" : "var(--crimson)",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Scale size={22} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h3 style={{ fontSize: "1.05rem", fontWeight: "700", color: "var(--ink-primary)" }}>
                  Conservation of Money Invariant
                </h3>
                <span className={`status-pill ${invariants.isConservationPreserved ? "success" : "danger"}`}>
                  {invariants.isConservationPreserved ? "VERIFIED (100% BALANCED)" : "VIOLATION DETECTED"}
                </span>
              </div>
              <p style={{ fontSize: "0.84rem", color: "var(--ink-secondary)", marginTop: "3px" }}>
                Sum of all distributed node balances equals Genesis Supply:{" "}
                <strong>{INR_FORMAT.format(invariants.currentTotalDeposits)}</strong> /{" "}
                <strong>{INR_FORMAT.format(invariants.genesisSupply)}</strong>. Zero leaks or double-spending.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "0.74rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>
                Total Debited
              </div>
              <div style={{ fontSize: "1.1rem", fontWeight: "700", color: "var(--upi-orange)" }}>
                {INR_FORMAT.format(invariants.totalDebited)}
              </div>
            </div>

            <div style={{ height: "30px", width: "1px", background: "var(--border-hairline)" }}></div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "0.74rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>
                Total Credited
              </div>
              <div style={{ fontSize: "1.1rem", fontWeight: "700", color: "var(--upi-green)" }}>
                {INR_FORMAT.format(invariants.totalCredited)}
              </div>
            </div>

            <div style={{ height: "30px", width: "1px", background: "var(--border-hairline)" }}></div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "0.74rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>
                Debit/Credit Parity
              </div>
              <div style={{ fontSize: "0.9rem", fontWeight: "700", color: invariants.debitCreditParity ? "var(--upi-green)" : "var(--crimson)" }}>
                {invariants.debitCreditParity ? "Δ = ₹0 (Equal)" : "Discrepancy"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bank CBS Node Summaries */}
      <div style={{ marginBottom: "24px" }}>
        <h3 style={{ fontSize: "1.05rem", fontWeight: "700", color: "var(--ink-primary)", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
          <Building2 size={18} style={{ color: "var(--upi-orange)" }} />
          Participating Core Banking Systems (CBS Nodes)
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px" }}>
          {banks.map((b) => (
            <div
              key={b.bank}
              className="card-clean"
              style={{
                padding: "16px",
                border: selectedBank === b.bank ? "2px solid var(--upi-green)" : "1px solid var(--border-hairline)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onClick={() => setSelectedBank(selectedBank === b.bank ? "ALL" : b.bank)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                <div>
                  <h4 style={{ fontSize: "0.95rem", fontWeight: "700", color: "var(--ink-primary)" }}>{b.bank}</h4>
                  <span style={{ fontSize: "0.75rem", color: "var(--ink-muted)" }}>{b.accountsCount} Customer Accounts</span>
                </div>
                <span className="status-pill info" style={{ fontSize: "0.7rem" }}>CBS Active</span>
              </div>

              <div style={{ fontSize: "1.25rem", fontWeight: "800", color: "var(--ink-primary)", margin: "8px 0" }}>
                {INR_FORMAT.format(b.totalBalance)}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem", color: "var(--ink-secondary)", borderTop: "1px solid var(--border-hairline)", paddingTop: "8px" }}>
                <span>Debits: <strong style={{ color: "var(--upi-orange)" }}>{INR_FORMAT.format(b.debits)}</strong></span>
                <span>Credits: <strong style={{ color: "var(--upi-green)" }}>{INR_FORMAT.format(b.credits)}</strong></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Account Balances Grid */}
      <div className="card-clean" style={{ marginBottom: "24px" }}>
        <div className="card-header-bar">
          <div className="card-title">
            <Users size={18} style={{ color: "var(--upi-green)" }} />
            User Account Balances & VPA Mapping
          </div>
          <span className="status-pill success">{accounts.length} Active Accounts</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px" }}>
          {accounts.map((acc) => (
            <div
              key={acc.upi_id}
              style={{
                padding: "14px 16px",
                borderRadius: "10px",
                border: "1px solid var(--border-hairline)",
                background: "#FFFFFF",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: "700", color: "var(--ink-primary)" }}>{acc.name}</span>
                <span className="status-pill info" style={{ fontSize: "0.7rem" }}>{acc.bank_name || acc.bank}</span>
              </div>
              <div style={{ fontSize: "0.82rem", color: "var(--ink-muted)", fontFamily: "monospace" }}>
                {acc.upi_id}
              </div>
              <div style={{ fontSize: "1.2rem", fontWeight: "800", color: "var(--upi-green)", marginTop: "4px" }}>
                {INR_FORMAT.format(acc.balance)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Double-Entry Journal Table */}
      <div className="card-clean">
        <div className="card-header-bar" style={{ flexWrap: "wrap", gap: "12px" }}>
          <div className="card-title">
            <BookOpen size={18} style={{ color: "var(--upi-orange)" }} />
            Double-Entry Append-Only Audit Journal
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            {/* Search Input */}
            <div style={{ position: "relative", minWidth: "200px" }}>
              <Search size={14} style={{ position: "absolute", left: "10px", top: "10px", color: "var(--ink-muted)" }} />
              <input
                type="text"
                placeholder="Search account, txn ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  padding: "6px 12px 6px 30px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-hairline)",
                  fontSize: "0.82rem",
                  width: "100%",
                }}
              />
            </div>

            {/* Bank Filter */}
            <select
              value={selectedBank}
              onChange={(e) => setSelectedBank(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid var(--border-hairline)",
                fontSize: "0.82rem",
                background: "#FFFFFF",
              }}
            >
              <option value="ALL">All Banks</option>
              {banks.map((b) => (
                <option key={b.bank} value={b.bank}>{b.bank}</option>
              ))}
            </select>

            {/* Type Filter */}
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid var(--border-hairline)",
                fontSize: "0.82rem",
                background: "#FFFFFF",
              }}
            >
              <option value="ALL">All Entry Types</option>
              <option value="DEBIT">Debit</option>
              <option value="CREDIT">Credit</option>
              <option value="COMPENSATING_CREDIT">Compensating Credit</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table className="clean-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-canvas)", borderBottom: "1px solid var(--border-hairline)", textAlign: "left" }}>
                <th style={{ padding: "10px 14px", fontSize: "0.78rem", color: "var(--ink-muted)" }}>Entry ID</th>
                <th style={{ padding: "10px 14px", fontSize: "0.78rem", color: "var(--ink-muted)" }}>Transaction ID</th>
                <th style={{ padding: "10px 14px", fontSize: "0.78rem", color: "var(--ink-muted)" }}>Timestamp</th>
                <th style={{ padding: "10px 14px", fontSize: "0.78rem", color: "var(--ink-muted)" }}>Account / User</th>
                <th style={{ padding: "10px 14px", fontSize: "0.78rem", color: "var(--ink-muted)" }}>Bank CBS</th>
                <th style={{ padding: "10px 14px", fontSize: "0.78rem", color: "var(--ink-muted)" }}>Type</th>
                <th style={{ padding: "10px 14px", fontSize: "0.78rem", color: "var(--ink-muted)", textAlign: "right" }}>Amount</th>
                <th style={{ padding: "10px 14px", fontSize: "0.78rem", color: "var(--ink-muted)" }}>State</th>
                <th style={{ padding: "10px 14px", fontSize: "0.78rem", color: "var(--ink-muted)" }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: "30px", textAlign: "center", color: "var(--ink-muted)" }}>
                    No journal entries found matching criteria.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => {
                  const isDebit = entry.entryType === "DEBIT";
                  const isRollback = entry.entryType === "COMPENSATING_CREDIT";
                  return (
                    <tr
                      key={entry.id + entry.accountUpi}
                      style={{ borderBottom: "1px solid var(--border-hairline)", fontSize: "0.83rem" }}
                    >
                      <td style={{ padding: "10px 14px", fontWeight: "700", fontFamily: "monospace" }}>
                        {entry.id}
                      </td>
                      <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "var(--ink-secondary)" }}>
                        {entry.transactionId}
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--ink-muted)", fontSize: "0.78rem" }}>
                        {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ fontWeight: "600", color: "var(--ink-primary)" }}>{entry.userName}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--ink-muted)", fontFamily: "monospace" }}>{entry.accountUpi}</div>
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <span className="status-pill info" style={{ fontSize: "0.72rem" }}>{entry.bank}</span>
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        {isDebit ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              color: "var(--upi-orange)",
                              fontWeight: "700",
                              fontSize: "0.78rem",
                            }}
                          >
                            <ArrowDownLeft size={13} /> DEBIT
                          </span>
                        ) : isRollback ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              color: "var(--blue-accent)",
                              fontWeight: "700",
                              fontSize: "0.78rem",
                            }}
                          >
                            <RefreshCw size={13} /> REFUND
                          </span>
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              color: "var(--upi-green)",
                              fontWeight: "700",
                              fontSize: "0.78rem",
                            }}
                          >
                            <ArrowUpRight size={13} /> CREDIT
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "10px 14px",
                          textAlign: "right",
                          fontWeight: "800",
                          fontFamily: "monospace",
                          color: isDebit ? "var(--upi-orange)" : "var(--upi-green)",
                        }}
                      >
                        {isDebit ? `-${INR_FORMAT.format(entry.amount)}` : `+${INR_FORMAT.format(entry.amount)}`}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <span
                          className={`status-pill ${
                            entry.status === "COMMITTED"
                              ? "success"
                              : entry.status === "ROLLED_BACK"
                              ? "warning"
                              : "info"
                          }`}
                          style={{ fontSize: "0.72rem" }}
                        >
                          {entry.status}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--ink-secondary)", fontSize: "0.8rem" }}>
                        {entry.description}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
}
