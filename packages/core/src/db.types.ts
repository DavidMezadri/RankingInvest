export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assets: {
        Row: {
          is_synced: boolean
          is_tradable: boolean
          lot_size: number
          name: string
          sector: string | null
          ticker: string
          type: Database["public"]["Enums"]["asset_type"]
          updated_at: string
        }
        Insert: {
          is_synced?: boolean
          is_tradable?: boolean
          lot_size?: number
          name: string
          sector?: string | null
          ticker: string
          type: Database["public"]["Enums"]["asset_type"]
          updated_at?: string
        }
        Update: {
          is_synced?: boolean
          is_tradable?: boolean
          lot_size?: number
          name?: string
          sector?: string | null
          ticker?: string
          type?: Database["public"]["Enums"]["asset_type"]
          updated_at?: string
        }
        Relationships: []
      }
      daily_candles: {
        Row: {
          close: number
          date: string
          high: number | null
          low: number | null
          open: number | null
          ticker: string
          volume: number | null
        }
        Insert: {
          close: number
          date: string
          high?: number | null
          low?: number | null
          open?: number | null
          ticker: string
          volume?: number | null
        }
        Update: {
          close?: number
          date?: string
          high?: number | null
          low?: number | null
          open?: number | null
          ticker?: string
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_candles_ticker_fkey"
            columns: ["ticker"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["ticker"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount: number
          description: string
          id: string
          kind: Database["public"]["Enums"]["ledger_kind"]
          occurred_at: string
          portfolio_id: string
        }
        Insert: {
          amount: number
          description: string
          id?: string
          kind: Database["public"]["Enums"]["ledger_kind"]
          occurred_at?: string
          portfolio_id: string
        }
        Update: {
          amount?: number
          description?: string
          id?: string
          kind?: Database["public"]["Enums"]["ledger_kind"]
          occurred_at?: string
          portfolio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      market_holidays: {
        Row: {
          date: string
          name: string
        }
        Insert: {
          date: string
          name: string
        }
        Update: {
          date?: string
          name?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          effective_from: string
          key: string
          value: Json
        }
        Insert: {
          effective_from?: string
          key: string
          value: Json
        }
        Update: {
          effective_from?: string
          key?: string
          value?: Json
        }
        Relationships: []
      }
      portfolios: {
        Row: {
          cash_balance: number
          created_at: string
          id: string
          season_id: string
          user_id: string
        }
        Insert: {
          cash_balance: number
          created_at?: string
          id?: string
          season_id: string
          user_id: string
        }
        Update: {
          cash_balance?: number
          created_at?: string
          id?: string
          season_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolios_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolios_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      quotes: {
        Row: {
          change_pct: number | null
          fetched_at: string
          prev_close: number | null
          price: number
          quoted_at: string
          source: string
          ticker: string
          volume: number | null
        }
        Insert: {
          change_pct?: number | null
          fetched_at?: string
          prev_close?: number | null
          price: number
          quoted_at: string
          source?: string
          ticker: string
          volume?: number | null
        }
        Update: {
          change_pct?: number | null
          fetched_at?: string
          prev_close?: number | null
          price?: number
          quoted_at?: string
          source?: string
          ticker?: string
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_ticker_fkey"
            columns: ["ticker"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["ticker"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          initial_cash: number
          is_active: boolean
          name: string
          starts_at: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          initial_cash?: number
          is_active?: boolean
          name: string
          starts_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          initial_cash?: number
          is_active?: boolean
          name?: string
          starts_at?: string
        }
        Relationships: []
      }
      sync_runs: {
        Row: {
          detail: string | null
          finished_at: string | null
          id: number
          job: string
          provider: string | null
          started_at: string
          status: string
          tickers_failed: number
          tickers_ok: number
        }
        Insert: {
          detail?: string | null
          finished_at?: string | null
          id?: never
          job: string
          provider?: string | null
          started_at?: string
          status?: string
          tickers_failed?: number
          tickers_ok?: number
        }
        Update: {
          detail?: string | null
          finished_at?: string | null
          id?: never
          job?: string
          provider?: string | null
          started_at?: string
          status?: string
          tickers_failed?: number
          tickers_ok?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      platform_setting: { Args: { p_key: string }; Returns: Json }
      trigger_sync_quotes: { Args: never; Returns: number }
    }
    Enums: {
      asset_type: "STOCK" | "FII" | "UNIT" | "BDR"
      ledger_kind:
        | "DEPOSIT"
        | "BUY"
        | "SELL"
        | "FEE"
        | "TAX"
        | "FI_APPLY"
        | "FI_REDEEM"
        | "FI_INTEREST"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      asset_type: ["STOCK", "FII", "UNIT", "BDR"],
      ledger_kind: [
        "DEPOSIT",
        "BUY",
        "SELL",
        "FEE",
        "TAX",
        "FI_APPLY",
        "FI_REDEEM",
        "FI_INTEREST",
      ],
    },
  },
} as const
