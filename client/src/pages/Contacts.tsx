import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import api from "@/lib/api";
import { Contact } from "@/lib/types";
import { Plus, Trash2, Phone, Star } from "lucide-react";

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("family");
  const [priority, setPriority] = useState(1);

  async function loadContacts() {
    const res = await api.get<Contact[]>("/contacts");
    setContacts(res.data);
    setLoading(false);
  }

  useEffect(() => {
    loadContacts();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await api.post("/contacts", { name, phone, relationship, priority });
    setName("");
    setPhone("");
    setRelationship("family");
    setPriority(1);
    setShowForm(false);
    loadContacts();
  }

  async function handleDelete(id: string) {
    await api.delete(`/contacts/${id}`);
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Trusted Contacts</h1>
            <p className="mt-1 text-ink-400">The people who get notified the moment an alert fires.</p>
          </div>
          <button onClick={() => setShowForm((s) => !s)} className="btn-beacon flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add contact
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="glass-panel mb-6 rounded-2xl p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-400">Name</label>
                <input required value={name} onChange={(e) => setName(e.target.value)} className="glass-input w-full" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-400">Phone</label>
                <input required value={phone} onChange={(e) => setPhone(e.target.value)} className="glass-input w-full" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-400">Relationship</label>
                <select
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  className="glass-input w-full"
                >
                  <option value="family">Family</option>
                  <option value="friend">Friend</option>
                  <option value="partner">Partner</option>
                  <option value="colleague">Colleague</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-400">
                  Priority (1 = notified first)
                </label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="glass-input w-full"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button type="submit" className="btn-beacon">Save contact</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-ghost">Cancel</button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : contacts.length === 0 ? (
          <div className="glass-panel rounded-2xl p-10 text-center">
            <p className="text-ink-400">No trusted contacts yet. Add at least one so alerts have somewhere to go.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {contacts
              .sort((a, b) => a.priority - b.priority)
              .map((contact) => (
                <div key={contact.id} className="glass-panel flex items-center justify-between rounded-2xl p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-signal-500/10 font-display text-lg font-semibold text-signal-400">
                      {contact.name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-ink-100">{contact.name}</p>
                      <div className="flex items-center gap-3 text-sm text-ink-400">
                        <span className="flex items-center gap-1">
                          <Phone className="h-3.5 w-3.5" /> {contact.phone}
                        </span>
                        <span className="capitalize">{contact.relationship}</span>
                        <span className="flex items-center gap-1 font-mono text-xs text-beacon-400">
                          <Star className="h-3 w-3" /> priority {contact.priority}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(contact.id)}
                    className="rounded-lg p-2 text-ink-500 transition-colors hover:bg-alarm-500/10 hover:text-alarm-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
