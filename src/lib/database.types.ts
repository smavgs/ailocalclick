export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Generated from the ailocalclick Supabase project schema. */
export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          gpu_memory_gb: number | null;
          gpu_name: string | null;
          id: string;
          preferred_os: string | null;
          ram_gb: number | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          gpu_memory_gb?: number | null;
          gpu_name?: string | null;
          id: string;
          preferred_os?: string | null;
          ram_gb?: number | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          gpu_memory_gb?: number | null;
          gpu_name?: string | null;
          id?: string;
          preferred_os?: string | null;
          ram_gb?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      saved_models: {
        Row: {
          id: number;
          model_name: string;
          model_slug: string;
          personal_note: string;
          saved_at: string;
          selected_tag: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          id?: number;
          model_name: string;
          model_slug: string;
          personal_note?: string;
          saved_at?: string;
          selected_tag?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          id?: number;
          model_name?: string;
          model_slug?: string;
          personal_note?: string;
          saved_at?: string;
          selected_tag?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
