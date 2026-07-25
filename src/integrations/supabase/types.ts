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
      cart: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity: number
          updated_at: string
          user_id: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity?: number
          updated_at?: string
          user_id: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          updated_at?: string
          user_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          is_active: boolean
          minor_unit: number
          name: string
          rate_to_usd: number
          symbol: string
          updated_at: string
        }
        Insert: {
          code: string
          is_active?: boolean
          minor_unit?: number
          name: string
          rate_to_usd?: number
          symbol: string
          updated_at?: string
        }
        Update: {
          code?: string
          is_active?: boolean
          minor_unit?: number
          name?: string
          rate_to_usd?: number
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          currency_code: string
          id: string
          image_snapshot: string | null
          order_id: string
          product_id: string | null
          quantity: number
          title_snapshot: string
          unit_price_minor: number
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          currency_code?: string
          id?: string
          image_snapshot?: string | null
          order_id: string
          product_id?: string | null
          quantity: number
          title_snapshot: string
          unit_price_minor: number
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          currency_code?: string
          id?: string
          image_snapshot?: string | null
          order_id?: string
          product_id?: string | null
          quantity?: number
          title_snapshot?: string
          unit_price_minor?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          currency_code: string
          id: string
          metadata: Json
          order_number: string
          shipping_address: Json | null
          shipping_minor: number
          status: Database["public"]["Enums"]["order_status"]
          subtotal_minor: number
          tax_minor: number
          total_minor: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency_code?: string
          id?: string
          metadata?: Json
          order_number?: string
          shipping_address?: Json | null
          shipping_minor?: number
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_minor?: number
          tax_minor?: number
          total_minor?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency_code?: string
          id?: string
          metadata?: Json
          order_number?: string
          shipping_address?: Json | null
          shipping_minor?: number
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_minor?: number
          tax_minor?: number
          total_minor?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      product_images: {
        Row: {
          alt: string | null
          created_at: string
          id: string
          is_primary: boolean
          position: number
          product_id: string
          url: string
        }
        Insert: {
          alt?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          position?: number
          product_id: string
          url: string
        }
        Update: {
          alt?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          position?: number
          product_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          attributes: Json
          created_at: string
          currency_code: string
          id: string
          image_url: string | null
          is_active: boolean
          price_minor: number
          product_id: string
          sku: string | null
          stock: number
          title: string | null
          updated_at: string
        }
        Insert: {
          attributes?: Json
          created_at?: string
          currency_code?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          price_minor?: number
          product_id: string
          sku?: string | null
          stock?: number
          title?: string | null
          updated_at?: string
        }
        Update: {
          attributes?: Json
          created_at?: string
          currency_code?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          price_minor?: number
          product_id?: string
          sku?: string | null
          stock?: number
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          attributes: Json
          base_price_minor: number
          category_id: string | null
          created_at: string
          currency_code: string
          description: string | null
          external_id: string
          id: string
          is_active: boolean
          last_synced_at: string | null
          min_order_qty: number
          provider: Database["public"]["Enums"]["provider_code"]
          rating: number | null
          review_count: number
          sales_count: number
          slug: string | null
          supplier_id: string | null
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          attributes?: Json
          base_price_minor?: number
          category_id?: string | null
          created_at?: string
          currency_code?: string
          description?: string | null
          external_id: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          min_order_qty?: number
          provider: Database["public"]["Enums"]["provider_code"]
          rating?: number | null
          review_count?: number
          sales_count?: number
          slug?: string | null
          supplier_id?: string | null
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          attributes?: Json
          base_price_minor?: number
          category_id?: string | null
          created_at?: string
          currency_code?: string
          description?: string | null
          external_id?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          min_order_qty?: number
          provider?: Database["public"]["Enums"]["provider_code"]
          rating?: number | null
          review_count?: number
          sales_count?: number
          slug?: string | null
          supplier_id?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          preferred_currency: string
          preferred_locale: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          preferred_currency?: string
          preferred_locale?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          preferred_currency?: string
          preferred_locale?: string
          updated_at?: string
        }
        Relationships: []
      }
      search_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          filters: Json
          hit_count: number
          id: string
          provider: Database["public"]["Enums"]["provider_code"]
          query: string
          result: Json
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          filters?: Json
          hit_count?: number
          id?: string
          provider: Database["public"]["Enums"]["provider_code"]
          query: string
          result: Json
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          filters?: Json
          hit_count?: number
          id?: string
          provider?: Database["public"]["Enums"]["provider_code"]
          query?: string
          result?: Json
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          external_id: string
          id: string
          logo_url: string | null
          metadata: Json
          name: string
          provider: Database["public"]["Enums"]["provider_code"]
          rating: number | null
          slug: string | null
          updated_at: string
          verified: boolean
          years_active: number | null
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          external_id: string
          id?: string
          logo_url?: string | null
          metadata?: Json
          name: string
          provider: Database["public"]["Enums"]["provider_code"]
          rating?: number | null
          slug?: string | null
          updated_at?: string
          verified?: boolean
          years_active?: number | null
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          external_id?: string
          id?: string
          logo_url?: string | null
          metadata?: Json
          name?: string
          provider?: Database["public"]["Enums"]["provider_code"]
          rating?: number | null
          slug?: string | null
          updated_at?: string
          verified?: boolean
          years_active?: number | null
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          error_message: string | null
          finished_at: string | null
          id: string
          items_failed: number
          items_processed: number
          metadata: Json
          operation: string
          provider: Database["public"]["Enums"]["provider_code"]
          started_at: string
          status: Database["public"]["Enums"]["sync_status"]
        }
        Insert: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          items_failed?: number
          items_processed?: number
          metadata?: Json
          operation: string
          provider: Database["public"]["Enums"]["provider_code"]
          started_at?: string
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Update: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          items_failed?: number
          items_processed?: number
          metadata?: Json
          operation?: string
          provider?: Database["public"]["Enums"]["provider_code"]
          started_at?: string
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wishlist: {
        Row: {
          created_at: string
          id: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role: "buyer" | "admin"
      order_status:
        | "pending"
        | "paid"
        | "processing"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "refunded"
      provider_code:
        | "internal"
        | "alibaba"
        | "aliexpress"
        | "taobao"
        | "sourcing_1688"
      sync_status: "running" | "success" | "failed"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["buyer", "admin"],
      order_status: [
        "pending",
        "paid",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ],
      provider_code: [
        "internal",
        "alibaba",
        "aliexpress",
        "taobao",
        "sourcing_1688",
      ],
      sync_status: ["running", "success", "failed"],
    },
  },
} as const
