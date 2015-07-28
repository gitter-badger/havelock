(ns docgen.ast)

; *****************************
; *** Data type definitions ***
; *****************************

(defrecord ParameterizedType [base-type params])
; e.g. Blah<K, V>

(defrecord ArrayType [base-type])
; e.g. String[]

(defrecord FunctionType [params return-type])
; e.g. (param1: SomeType, param2: Blah<K, V>, ...more: String[]) => Blah<X,Y>

(defrecord Parameter [name type])
; e.g. param1: SomeType

(defrecord FunctionSignature [doc type-args params return-type])

(defrecord Function [name signatures])
(defrecord Method [name signatures])
; e.g. myFunc<TypeArg>(...params: any[]): ReturnType;

(defrecord Property [name doc type])
; e.g. myProperty: int;

(defrecord Module [name doc members])
; e.g. declare module mymodule { stuff }

(defrecord Interface [name type-args doc extends members])
; e.g. export interface MyInterface { stuff }

; *********************
; *** Parsing logic ***
; *********************

(declare parse-params)
(declare parse-type)
(declare parse-function-type)
(declare parse-function)
(declare parse-interface)
(declare parse-module)

(defn parse-function-type [[params return-type]]
  (FunctionType. (parse-params params) (parse-type return-type)))

(defn parse-type [type]
  (cond
    (symbol? type) type
    (vector? type) (ArrayType. (parse-type (type 0)))
    (list? type)   (let [[hd & tl] type]
                     (if (= hd '=>)
                       (parse-function-type tl)
                       (ParameterizedType. hd (mapv parse-type tl))))))

(defn parse-name [nm]
  (if (list? nm)
    [(str (first nm)) (mapv parse-type (rest nm))]
    [(str nm) []]))

(defn parse-params [[nm type & more]]
  (when nm
    (cons (Parameter. (name nm) (parse-type type))
          (parse-params more))))

(defn parse-function-or-method [constructor [name params return-type & [doc]]]
  (let [[name type-args] (parse-name name)]
    (constructor. name
                  [ (FunctionSignature. doc
                                        type-args
                                        (parse-params params)
                                        (parse-type return-type)) ])))

(defn parse-property [[name type & [doc]]]
  (Property. (str name) doc (parse-type type)))

(defn parse-extends [[_ & types]]
  (mapv parse-type types))

(defn include-extends [interface decl]
  (update-in interface [:extends] into (parse-extends decl)))

(defn member-includer [decl-parser]
  (fn [acc decl]
    (update-in acc [:members] conj (decl-parser decl))))

(defn include-function-or-method [constructor acc decl]
  (let [func (parse-function-or-method constructor decl)
        name (:name func)
        [i existing] (first (keep-indexed (fn [i member]
                                              (when (= name (:name member))
                                                [i member]))
                                          (:members acc)))]
    (if existing
      (update-in acc [:members i :signatures] into (:signatures func))
      (update-in acc [:members] conj func))))

(defn include-doc [{doc :doc :as acc} more-doc]
  (assoc acc :doc (if (not-empty doc)
                    (str doc "\n\n" more-doc)
                    more-doc)))

(defn decl-type [[k args & more :as decl]]
  (cond
    (string? decl) :doc
    (keyword? k)   k
    (vector? args) :function
    :else          :property))



(defn include-member [includers thing member]
  (let [include (includers (decl-type member))]
    (include thing member)))

(declare interface-includers)
(declare module-includers)

(defn parse-interface [[_ name & members]]
  (let [[name type-args] (parse-name name)
        interface (Interface. name type-args "" [] [])]
    (reduce (partial include-member interface-includers) interface members)))

(defn parse-module [[_ name & members]]
  (let [module (Module. (str name) "" [])]
    (reduce (partial include-member module-includers) module members)))

(def module-includers { :extends   include-extends
                        :doc       include-doc
                        :interface (member-includer parse-interface)
                        :module    (member-includer parse-module)
                        :function  (partial include-function-or-method Function)
                        :property  (member-includer parse-property) })

(def interface-includers (assoc module-includers
                                :function
                                (partial include-function-or-method Method)))