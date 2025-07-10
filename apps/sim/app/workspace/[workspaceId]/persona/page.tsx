"use client";
import React, { useEffect, useMemo, useState } from "react";
import { PersonaHeader } from "./components/PersonaHeader";
import { PersonaOverview } from "./components/PersonaOverview";
import { EmptyStateCard } from "./components/EmptyStateCard";
import { CreatePersonaModal } from "./components/CreatePersonaModal";
import { PrimaryButton } from "../knowledge/components/primary-button/primary-button";
import { SearchInput } from "../knowledge/components/search-input/search-input";
import { AgentIcon } from "@/components/icons";
import { useParams } from "next/navigation";
import { useSidebarStore } from "@/stores/sidebar/store";

export default function PersonaPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const { mode, isExpanded } = useSidebarStore();
  const isSidebarCollapsed =
    mode === "expanded"
      ? !isExpanded
      : mode === "collapsed" || mode === "hover";

  const [personas, setPersonas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch personas from backend
  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    fetch(`/api/persona?workspaceId=${workspaceId}`)
      .then((res) => res.json())
      .then(async (data) => {
        setPersonas(data.personas || []);
        setLoading(false);
      })
      .catch((err) => {
        setError("Failed to load personas");
        setLoading(false);
      });
  }, [workspaceId]);

  const filteredPersonas = useMemo(() => {
    if (!searchQuery.trim()) return personas;
    const query = searchQuery.toLowerCase();
    return personas.filter(
      (a) =>
        a.name.toLowerCase().includes(query) ||
        a.description?.toLowerCase().includes(query)
    );
  }, [personas, searchQuery]);

  const handleCreatePersona = async (form: {
    name: string;
    description: string;
    photo: string;
    workflows: string[];
  }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          photo: form.photo,
          workspaceId,
        }),
      });
      if (!res.ok) throw new Error("Failed to create persona");
      const data = await res.json();
      // Assign workflows
      await Promise.all(
        (form.workflows || []).map((wfId) =>
          fetch("/api/persona/workflow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              personaId: data.persona.id,
              workflowId: wfId,
              status: "in progress",
            }),
          })
        )
      );
      setPersonas((prev) => [
        ...prev,
        { ...data.persona, workflows: [], connectedPersonas: [] },
      ]);
    } catch (err) {
      setError("Failed to create persona");
    } finally {
      setLoading(false);
    }
  };

  const breadcrumbs = [{ id: "persona", label: "Personas" }];

  return (
    <>
      <div
        className={`flex h-screen flex-col transition-padding duration-200 ${isSidebarCollapsed ? "pl-14" : "pl-60"}`}
      >
        {/* Header */}
        <PersonaHeader breadcrumbs={breadcrumbs} />
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Main Content */}
            <div className="flex-1 overflow-auto">
              <div className="px-6 pb-6">
                {/* Search and Create Section */}
                <div className="mb-4 flex items-center justify-between pt-1">
                  <SearchInput
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search personas..."
                  />
                  <PrimaryButton onClick={() => setIsCreateModalOpen(true)}>
                    <AgentIcon className="h-3.5 w-3.5" />
                    <span>New Persona</span>
                  </PrimaryButton>
                </div>
                {/* Error State */}
                {error && (
                  <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-4">
                    <p className="text-red-800 text-sm">
                      Error loading personas: {error}
                    </p>
                  </div>
                )}
                {/* Content Area */}
                {loading ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-32 rounded-md bg-muted animate-pulse"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredPersonas.length === 0 ? (
                      personas.length === 0 ? (
                        <EmptyStateCard
                          title="Create your first persona"
                          description="Personas help you automate tasks and workflows."
                          buttonText="Create Persona"
                          onClick={() => setIsCreateModalOpen(true)}
                          icon={
                            <AgentIcon className="h-4 w-4 text-muted-foreground" />
                          }
                        />
                      ) : (
                        <div className="col-span-full py-12 text-center">
                          <p className="text-muted-foreground">
                            No personas match your search.
                          </p>
                        </div>
                      )
                    ) : (
                      filteredPersonas.map((a) => (
                        <PersonaOverview
                          key={a.id}
                          id={a.id}
                          name={a.name}
                          description={
                            a.description || "No description provided"
                          }
                          workflowCount={a.workflows?.length || 0}
                          photo={a.photo}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Create Modal */}
      <CreatePersonaModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onCreate={handleCreatePersona}
      />
    </>
  );
}
