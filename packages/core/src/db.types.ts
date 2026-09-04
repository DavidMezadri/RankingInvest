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
      fixed_income_investments: {
        Row: {
          accrued_value: number
          applied_on: string
          created_at: string
          id: string
          last_accrual_on: string
          portfolio_id: string
          principal: number
          product_id: string
          redeem_gross: number | null
          redeem_net: number | null
          redeem_tax: number | null
          redeemed_at: string | null
        }
        Insert: {
          accrued_value: number
          applied_on: string
          created_at?: string
          id?: string
          last_accrual_on: string
          portfolio_id: string
          principal: number
          product_id: string
          redeem_gross?: number | null
          redeem_net?: number | null
          redeem_tax?: number | null
          redeemed_at?: string | null
        }
        Update: {
          accrued_value?: number
          applied_on?: string
          created_at?: string
          id?: string
          last_accrual_on?: string
          portfolio_id?: string
          principal?: number
          product_id?: string
          redeem_gross?: number | null
          redeem_net?: number | null
          redeem_tax?: number | null
          redeemed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixed_income_investments_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_income_investments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "fixed_income_products"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_income_products: {
        Row: {
          annual_rate: number
          id: string
          is_active: boolean
          is_tax_exempt: boolean
          issuer: string
          kind: Database["public"]["Enums"]["fi_kind"]
          liquidity: Database["public"]["Enums"]["fi_liquidity"]
          maturity_date: string
          min_investment: number
          name: string
        }
        Insert: {
          annual_rate: number
          id?: string
          is_active?: boolean
          is_tax_exempt?: boolean
          issuer: string
          kind: Database["public"]["Enums"]["fi_kind"]
          liquidity: Database["public"]["Enums"]["fi_liquidity"]
          maturity_date: string
          min_investment?: number
          name: string
        }
        Update: {
          annual_rate?: number
          id?: string
          is_active?: boolean
          is_tax_exempt?: boolean
          issuer?: string
          kind?: Database["public"]["Enums"]["fi_kind"]
          liquidity?: Database["public"]["Enums"]["fi_liquidity"]
          maturity_date?: string
          min_investment?: number
          name?: string
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          amount: number
          description: string
          id: string
          investment_id: string | null
          kind: Database["public"]["Enums"]["ledger_kind"]
          occurred_at: string
          order_id: string | null
          portfolio_id: string
        }
        Insert: {
          amount: number
          description: string
          id?: string
          investment_id?: string | null
          kind: Database["public"]["Enums"]["ledger_kind"]
          occurred_at?: string
          order_id?: string | null
          portfolio_id: string
        }
        Update: {
          amount?: number
          description?: string
          id?: string
          investment_id?: string | null
          kind?: Database["public"]["Enums"]["ledger_kind"]
          occurred_at?: string
          order_id?: string | null
          portfolio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_investment_id_fkey"
            columns: ["investment_id"]
            isOneToOne: false
            referencedRelation: "fixed_income_investments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
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
      orders: {
        Row: {
          created_at: string
          executed_price: number | null
          fee_amount: number | null
          gross_amount: number | null
          id: string
          net_amount: number | null
          portfolio_id: string
          quantity: number
          realized_pnl: number | null
          reference_price: number | null
          rejection_code: string | null
          side: Database["public"]["Enums"]["order_side"]
          status: Database["public"]["Enums"]["order_status"]
          tax_amount: number | null
          ticker: string
        }
        Insert: {
          created_at?: string
          executed_price?: number | null
          fee_amount?: number | null
          gross_amount?: number | null
          id?: string
          net_amount?: number | null
          portfolio_id: string
          quantity: number
          realized_pnl?: number | null
          reference_price?: number | null
          rejection_code?: string | null
          side: Database["public"]["Enums"]["order_side"]
          status: Database["public"]["Enums"]["order_status"]
          tax_amount?: number | null
          ticker: string
        }
        Update: {
          created_at?: string
          executed_price?: number | null
          fee_amount?: number | null
          gross_amount?: number | null
          id?: string
          net_amount?: number | null
          portfolio_id?: string
          quantity?: number
          realized_pnl?: number | null
          reference_price?: number | null
          rejection_code?: string | null
          side?: Database["public"]["Enums"]["order_side"]
          status?: Database["public"]["Enums"]["order_status"]
          tax_amount?: number | null
          ticker?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_ticker_fkey"
            columns: ["ticker"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["ticker"]
          },
        ]
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
      portfolio_snapshots: {
        Row: {
          cash: number
          created_at: string
          date: string
          equity_value: number
          fixed_income_value: number
          portfolio_id: string
          total_value: number
        }
        Insert: {
          cash: number
          created_at?: string
          date: string
          equity_value?: number
          fixed_income_value?: number
          portfolio_id: string
          total_value: number
        }
        Update: {
          cash?: number
          created_at?: string
          date?: string
          equity_value?: number
          fixed_income_value?: number
          portfolio_id?: string
          total_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_snapshots_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
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
      positions: {
        Row: {
          avg_price: number
          id: string
          portfolio_id: string
          quantity: number
          ticker: string
          updated_at: string
        }
        Insert: {
          avg_price: number
          id?: string
          portfolio_id: string
          quantity: number
          ticker: string
          updated_at?: string
        }
        Update: {
          avg_price?: number
          id?: string
          portfolio_id?: string
          quantity?: number
          ticker?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_ticker_fkey"
            columns: ["ticker"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["ticker"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          is_admin: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          is_admin?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_admin?: boolean
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
      leaderboard: {
        Row: {
          as_of: string | null
          avatar_url: string | null
          display_name: string | null
          initial_cash: number | null
          is_me: boolean | null
          rank: number | null
          return_pct: number | null
          season_name: string | null
          total_value: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_fixed_income_tx: {
        Args: { p_principal: number; p_product_id: string; p_user_id: string }
        Returns: {
          accrued_value: number
          applied_on: string
          created_at: string
          id: string
          last_accrual_on: string
          portfolio_id: string
          principal: number
          product_id: string
          redeem_gross: number | null
          redeem_net: number | null
          redeem_tax: number | null
          redeemed_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "fixed_income_investments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_season: {
        Args: { p_season_id: string }
        Returns: {
          created_at: string
          ends_at: string | null
          id: string
          initial_cash: number
          is_active: boolean
          name: string
          starts_at: string
        }
        SetofOptions: {
          from: "*"
          to: "seasons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      execute_order_tx: {
        Args: {
          p_executed_price: number
          p_fee_amount: number
          p_gross_amount: number
          p_net_amount: number
          p_new_avg_price: number
          p_quantity: number
          p_realized_pnl: number
          p_reference_price: number
          p_side: Database["public"]["Enums"]["order_side"]
          p_tax_amount: number
          p_ticker: string
          p_user_id: string
        }
        Returns: {
          created_at: string
          executed_price: number | null
          fee_amount: number | null
          gross_amount: number | null
          id: string
          net_amount: number | null
          portfolio_id: string
          quantity: number
          realized_pnl: number | null
          reference_price: number | null
          rejection_code: string | null
          side: Database["public"]["Enums"]["order_side"]
          status: Database["public"]["Enums"]["order_status"]
          tax_amount: number | null
          ticker: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_admin: { Args: never; Returns: boolean }
      open_season: {
        Args: { p_initial_cash?: number; p_name: string }
        Returns: {
          created_at: string
          ends_at: string | null
          id: string
          initial_cash: number
          is_active: boolean
          name: string
          starts_at: string
        }
        SetofOptions: {
          from: "*"
          to: "seasons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_setting: { Args: { p_key: string }; Returns: Json }
      redeem_fixed_income_tx: {
        Args: {
          p_gross: number
          p_investment_id: string
          p_net: number
          p_tax: number
          p_user_id: string
        }
        Returns: {
          accrued_value: number
          applied_on: string
          created_at: string
          id: string
          last_accrual_on: string
          portfolio_id: string
          principal: number
          product_id: string
          redeem_gross: number | null
          redeem_net: number | null
          redeem_tax: number | null
          redeemed_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "fixed_income_investments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      trigger_close_day: { Args: never; Returns: number }
      trigger_sync_quotes: { Args: never; Returns: number }
    }
    Enums: {
      asset_type: "STOCK" | "FII" | "UNIT" | "BDR"
      fi_kind: "CDB" | "LCI" | "LCA" | "TESOURO"
      fi_liquidity: "DAILY" | "AT_MATURITY"
      ledger_kind:
        | "DEPOSIT"
        | "BUY"
        | "SELL"
        | "FEE"
        | "TAX"
        | "FI_APPLY"
        | "FI_REDEEM"
        | "FI_INTEREST"
      order_side: "BUY" | "SELL"
      order_status: "FILLED" | "REJECTED"
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
      fi_kind: ["CDB", "LCI", "LCA", "TESOURO"],
      fi_liquidity: ["DAILY", "AT_MATURITY"],
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
      order_side: ["BUY", "SELL"],
      order_status: ["FILLED", "REJECTED"],
    },
  },
} as const
